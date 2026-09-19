/**
 * Meta (Facebook + Instagram) Ad Library scraper.
 *
 * Talks to Graph API's /ads_archive endpoint with two modes:
 *   1) search_terms   — keyword/brand text search
 *   2) search_page_ids — exact page-level scoop (fixes the "URL only,
 *      shortened-link" coverage hole the user flagged: page-scoped
 *      results catch ads even when the destination URL is hidden,
 *      shortened, or routed through a tracker)
 *
 * Why both: search_terms surfaces relevant pages we may not know yet;
 * search_page_ids re-queries each page for a clean "every active ad
 * by this advertiser" snapshot. Combining the two and deduping by
 * Meta's ad_id is what makes the catch denser than the public web UI.
 *
 * Auth: requires a user/app access token with `ads_read` scope. Drop
 * it into .env.local as META_ACCESS_TOKEN. Without it, every call
 * throws — caller surfaces a clean "token missing" error in the UI.
 *
 * Note: unlike Google ATC, Meta's archive doesn't expose impression
 * or view counts for non-political/non-issue ads (KR commercial ads
 * fall in this bucket). We capture creative copy + page identity +
 * delivery time window + platform mix instead.
 */

const GRAPH_BASE =
  process.env.META_GRAPH_BASE || "https://graph.facebook.com/v23.0";
const FIELDS = [
  "id",
  "page_id",
  "page_name",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_creative_link_descriptions",
  "ad_creative_link_captions",
  "ad_snapshot_url",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "languages",
  "publisher_platforms",
  "target_locations",
  "target_ages",
  "target_gender",
].join(",");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export type MetaScrapedAd = {
  adArchiveId: string;
  pageId: string;
  pageName: string;
  bodies: string[]; // ad_creative_bodies
  linkTitles: string[];
  linkDescriptions: string[];
  linkCaptions: string[];
  snapshotUrl: string | null;
  startTime: string | null; // ISO
  stopTime: string | null;
  languages: string[];
  publisherPlatforms: string[]; // FACEBOOK / INSTAGRAM / MESSENGER / AUDIENCE_NETWORK
  // Web-scrape only (Graph API path leaves these null) ----------------
  mediaUrl?: string | null;     // creative thumbnail (600x600)
  mediaType?: "video" | "image"; // detected from <video> tag presence
  avatarUrl?: string | null;    // page avatar (60x60)
  lpUrl?: string | null;        // decoded destination URL
  lpDomain?: string | null;     // hostname of lpUrl (e.g. example-shop.com)
  utmCampaign?: string | null;  // ad-unit identifier
  utmTerm?: string | null;
  utmContent?: string | null;
};

type RawAd = {
  id: string;
  page_id?: string;
  page_name?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  ad_creative_link_captions?: string[];
  ad_snapshot_url?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  languages?: string[];
  publisher_platforms?: string[];
};

function normalize(ad: RawAd): MetaScrapedAd {
  return {
    adArchiveId: ad.id,
    pageId: ad.page_id ?? "",
    pageName: ad.page_name ?? "",
    bodies: ad.ad_creative_bodies ?? [],
    linkTitles: ad.ad_creative_link_titles ?? [],
    linkDescriptions: ad.ad_creative_link_descriptions ?? [],
    linkCaptions: ad.ad_creative_link_captions ?? [],
    snapshotUrl: ad.ad_snapshot_url ?? null,
    startTime: ad.ad_delivery_start_time ?? null,
    stopTime: ad.ad_delivery_stop_time ?? null,
    languages: ad.languages ?? [],
    publisherPlatforms: ad.publisher_platforms ?? [],
  };
}

type CallParams = Record<string, string>;

async function callOnce(
  params: CallParams
): Promise<{ data: RawAd[]; nextCursor: string | null }> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token)
    throw new Error(
      "META_ACCESS_TOKEN not set — get a Graph API token with ads_read scope"
    );
  const url = new URL(`${GRAPH_BASE}/ads_archive`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", FIELDS);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `Meta ads_archive ${res.status}: ${detail.slice(0, 400)}`
    );
  }
  const json = (await res.json()) as {
    data?: RawAd[];
    paging?: { cursors?: { after?: string }; next?: string };
  };
  // Graph API uses cursor-based pagination — `after` is the token for
  // the next page. When `next` is missing we've reached the end.
  const nextCursor =
    json.paging?.next && json.paging.cursors?.after
      ? json.paging.cursors.after
      : null;
  return { data: json.data ?? [], nextCursor };
}

async function paginate(
  baseParams: CallParams,
  options?: {
    maxPages?: number;
    pageSleepMs?: number;
    onPage?: (pageIdx: number, batch: number, total: number) => void;
  }
): Promise<MetaScrapedAd[]> {
  const maxPages = options?.maxPages ?? 50;
  const pageSleepMs = options?.pageSleepMs ?? 1500;
  const seen = new Set<string>();
  const out: MetaScrapedAd[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const params = { ...baseParams };
    if (cursor) params.after = cursor;
    const res = await callOnce(params);
    let added = 0;
    for (const raw of res.data) {
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      out.push(normalize(raw));
      added++;
    }
    options?.onPage?.(i + 1, added, out.length);
    cursor = res.nextCursor;
    if (!cursor || added === 0) break;
    await sleep(pageSleepMs);
  }
  return out;
}

const COMMON_PARAMS: CallParams = {
  ad_active_status: "ALL",
  ad_type: "ALL",
  ad_reached_countries: "['KR']",
  limit: "50",
};

/**
 * Search by free-form text — picks up ads whose creative copy mentions
 * the brand, even when the destination URL is hidden/shortened.
 */
export async function searchByTerms(
  terms: string,
  options?: Parameters<typeof paginate>[1]
): Promise<MetaScrapedAd[]> {
  return paginate(
    { ...COMMON_PARAMS, search_terms: terms },
    options
  );
}

/**
 * Page-scoped scoop — every ad-archive entry served by a specific
 * Facebook page. Use this once you've discovered page_ids via
 * searchByTerms; it catches the URL-hidden / shortened-link long-tail.
 */
export async function searchByPageIds(
  pageIds: string[],
  options?: Parameters<typeof paginate>[1]
): Promise<MetaScrapedAd[]> {
  if (pageIds.length === 0) return [];
  return paginate(
    {
      ...COMMON_PARAMS,
      // Graph API expects a JSON-array string here.
      search_page_ids: JSON.stringify(pageIds),
    },
    options
  );
}

/**
 * High-level entrypoint — runs the full dense-collection pipeline for
 * one brand keyword:
 *   1. searchByTerms(keyword)
 *   2. extract unique page_ids from the result
 *   3. searchByPageIds(...) for each discovered page
 *   4. dedupe by ad_id and merge
 *
 * Returns both the merged ad list and the page roster so callers can
 * persist the brand → pages mapping for future incremental refresh.
 */
export async function denseCollect(
  keyword: string,
  options?: {
    maxPagesPerCall?: number;
    onLog?: (line: string) => void;
  }
): Promise<{
  ads: MetaScrapedAd[];
  pages: Array<{ pageId: string; pageName: string; adsFromTerms: number }>;
}> {
  const log = (m: string) => options?.onLog?.(m);
  const maxPages = options?.maxPagesPerCall ?? 30;

  log(`stage 1: search_terms="${keyword}"`);
  const t0 = Date.now();
  const termHits = await searchByTerms(keyword, {
    maxPages,
    onPage: (i, added, total) =>
      log(`  page ${i}: +${added} (cumulative ${total})`),
  });
  log(`  → ${termHits.length} ads from search_terms in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Tally page_ids by frequency so we know which pages dominate.
  const byPage = new Map<string, { pageName: string; count: number }>();
  for (const ad of termHits) {
    if (!ad.pageId) continue;
    const slot = byPage.get(ad.pageId) ?? { pageName: ad.pageName, count: 0 };
    slot.count++;
    byPage.set(ad.pageId, slot);
  }
  const pages = Array.from(byPage.entries())
    .map(([pageId, v]) => ({
      pageId,
      pageName: v.pageName,
      adsFromTerms: v.count,
    }))
    .sort((a, b) => b.adsFromTerms - a.adsFromTerms);
  log(`  → ${pages.length} unique pages discovered`);

  log(`stage 2: re-scoop each page via search_page_ids`);
  const pageIdList = pages.map((p) => p.pageId);
  const pageHits = await searchByPageIds(pageIdList, {
    maxPages,
    onPage: (i, added, total) =>
      log(`  page ${i}: +${added} (cumulative ${total})`),
  });
  log(`  → ${pageHits.length} ads from search_page_ids`);

  // Merge + dedupe by adArchiveId.
  const merged = new Map<string, MetaScrapedAd>();
  for (const a of termHits) merged.set(a.adArchiveId, a);
  for (const a of pageHits) merged.set(a.adArchiveId, a);
  log(
    `stage 3: deduped → ${merged.size} unique ads (terms ${termHits.length} + pages ${pageHits.length})`
  );

  return { ads: Array.from(merged.values()), pages };
}
