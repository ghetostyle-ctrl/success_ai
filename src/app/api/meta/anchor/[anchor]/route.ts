/**
 * GET /api/meta/anchor/:anchor
 *
 * Returns a JobDetail-shaped aggregate spanning EVERY MetaWatch tied to
 * this anchor brand. The user's mental model: "덱카닉" = the brand
 * keyword + the 4 sock-puppet pages they manually pinned + any pages
 * stage-1.5 auto-discovers later. They want one unified card list, not
 * five separate jobs.
 *
 * Aggregation rules:
 *   - Watches in scope:  watch.keyword === anchor  OR
 *                        watch.anchorKeyword === anchor.
 *   - Ads in scope:      MetaAd whose keyword is in the watch keyword
 *                        set (deduped by adArchiveId — same ad reposted
 *                        under the brand-keyword search and a page-id
 *                        scoop only counts once).
 *   - Status:            in_progress > queued > error > complete (so
 *                        any pending job keeps the badge "🔄").
 *   - Logs:              tail 12 lines of each child job's logs,
 *                        prefixed with the keyword for traceability.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  batchFetchAdLibrarySignals,
  resolveAdLpUrl,
} from "@/lib/meta-scraper-web";

type Ctx = { params: Promise<{ anchor: string }> };

// In-process enrichment progress tracker, keyed by anchor. Survives
// HMR reloads via globalThis (same pattern as meta-worker queue).
type EnrichProgress = {
  status: "running" | "done" | "error";
  done: number;
  total: number;
  startedAt: number;
  finishedAt?: number;
  error?: string;
};
const g = globalThis as unknown as {
  __metaEnrich?: Map<string, EnrichProgress>;
};
const enrichRegistry: Map<string, EnrichProgress> =
  (g.__metaEnrich ??= new Map());

const STATUS_RANK: Record<string, number> = {
  in_progress: 4,
  queued: 3,
  error: 2,
  complete: 1,
};

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { anchor: rawAnchor } = await params;
  const anchor = decodeURIComponent(rawAnchor);

  // 1. Find every watch tied to this anchor — both the seed brand
  //    keyword itself (where keyword === anchor) and any descendants
  //    (manual page-id additions, auto-discovered entities).
  const watches = await prisma.metaWatch.findMany({
    where: {
      OR: [{ keyword: anchor }, { anchorKeyword: anchor }],
    },
    select: {
      keyword: true,
      source: true,
      anchorKeyword: true,
      lastRunAt: true,
      metaResultCount: true,
    },
  });
  const keywords = Array.from(new Set(watches.map((w) => w.keyword)));
  if (keywords.length === 0) {
    return NextResponse.json({ error: "anchor not found" }, { status: 404 });
  }

  // 2. Pull the latest job per keyword. The aggregated view tracks
  //    "current state of every child" — older runs are ignored.
  const jobs = await prisma.metaJob.findMany({
    where: { keyword: { in: keywords } },
    orderBy: { createdAt: "desc" },
  });
  const latestByKeyword = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) {
    if (!latestByKeyword.has(j.keyword)) latestByKeyword.set(j.keyword, j);
  }

  // 3. Determine combined status — surface "currently running" to the
  //    user even if just one child is mid-scrape.
  let bestStatus = "complete";
  let bestRank = 0;
  for (const j of latestByKeyword.values()) {
    const r = STATUS_RANK[j.status] ?? 0;
    if (r > bestRank) {
      bestRank = r;
      bestStatus = j.status;
    }
  }

  // 4. Pull every ad whose keyword belongs to the anchor's watch set,
  //    dedupe by adArchiveId. Same ad shows up once even if both the
  //    brand-keyword search and a page-id scoop captured it.
  const ads = await prisma.metaAd.findMany({
    where: { keyword: { in: keywords } },
    orderBy: { savedAt: "desc" },
    take: 5000,
  });
  const seen = new Set<string>();
  const uniqueAds: typeof ads = [];
  for (const a of ads) {
    if (seen.has(a.adArchiveId)) continue;
    seen.add(a.adArchiveId);
    uniqueAds.push(a);
  }

  // === A-tier scoring inputs ===
  // Signals enabled (per user's calibration):
  //   1. Days running              — long-running = passed brand's kill cut
  //   3. Variant count             — same body / lpUrl repeated under brand
  //                                  = brand iterating on a winner
  //   5. Active boolean            — currently still being served
  //   9. YouTube cross-reference   — if ad's body / lpUrl contains a YT
  //                                  id we already track in the ATC Ad
  //                                  table, attach that ATC ad's view
  //                                  count as a high-confidence proxy.
  // Rejected (per user's experiment): 2 cross-page, 4 platforms, 7
  // media-type, 8 utm-diversity. Display-order is also unreliable.

  // 4a. Variant clustering: hash by first 80 chars of body OR lpUrl.
  // Each ad's `variantCount` = how many other unique adArchiveIds in
  // this brand share that signature. 1 means "alone", 5 means brand
  // is heavily testing this creative angle.
  const sigOf = (a: (typeof ads)[number]): string => {
    if (a.lpUrl) {
      try {
        const u = new URL(a.lpUrl);
        return `lp:${u.origin}${u.pathname}`;
      } catch {
        // fall through
      }
    }
    const bodyArr = parseArr(a.bodies);
    const head = (bodyArr[0] ?? "").trim().slice(0, 80);
    return head ? `body:${head}` : `id:${a.adArchiveId}`;
  };
  const sigCounts = new Map<string, number>();
  for (const a of uniqueAds) {
    const k = sigOf(a);
    sigCounts.set(k, (sigCounts.get(k) ?? 0) + 1);
  }

  // 4b. YouTube cross-link sources:
  //   (1) Body / lp text contains youtu.be/...id (rare for KR ads)
  //   (2) Phase-3a resolvedYoutubeId — populated when an ad's BIT.LY
  //       LP unwraps to youtube.com (this is the case that actually
  //       fires for direct-response ads).
  //   (3) Phase-3b: brand-name match against ATC Ad.advertiserName
  //       gives BRAND-LEVEL context (top videos per anchor) — added
  //       further down so it doesn't pollute per-ad scores.
  const YT_RE = /(?:youtu\.be\/|\/watch\?v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/g;
  const adYtIds = new Map<string, string[]>();
  const ytIdSet = new Set<string>();
  for (const a of uniqueAds) {
    const ids = new Set<string>();
    const haystack = `${a.bodies ?? ""} ${a.linkTitles ?? ""} ${a.linkDescriptions ?? ""} ${a.lpUrl ?? ""}`;
    for (const m of haystack.matchAll(YT_RE)) {
      ids.add(m[1]);
      ytIdSet.add(m[1]);
    }
    if (a.resolvedYoutubeId) {
      ids.add(a.resolvedYoutubeId);
      ytIdSet.add(a.resolvedYoutubeId);
    }
    if (ids.size > 0) adYtIds.set(a.adArchiveId, Array.from(ids));
  }
  const ytStats = new Map<
    string,
    { ytViews: number | null; ytTitle: string | null; ytChannel: string | null }
  >();
  if (ytIdSet.size > 0) {
    const matched = await prisma.ad.findMany({
      where: { youtubeId: { in: Array.from(ytIdSet) } },
      select: { youtubeId: true, ytViews: true, ytTitle: true, ytChannel: true },
    });
    for (const m of matched) {
      if (m.youtubeId) {
        ytStats.set(m.youtubeId, {
          ytViews: m.ytViews,
          ytTitle: m.ytTitle,
          ytChannel: m.ytChannel,
        });
      }
    }
  }

  // === Phase-3b: brand-level ATC context ===
  // For the anchor brand, surface ATC YouTube ads that share the brand
  // keyword OR whose advertiserName contains the brand stem. Brand-
  // level only — not per-ad — so we keep the per-ad scoring clean
  // (per-ad needs an exact youtubeId match).
  const stemForAtc = anchor
    .replace(/^page:/, "")
    .replace(/\.(co\.kr|kr|com|net|io)$/i, "")
    .replace(/[^a-z0-9가-힣]/gi, "")
    .toLowerCase();
  const atcRows =
    stemForAtc.length >= 3
      ? await prisma.ad.findMany({
          where: {
            youtubeId: { not: null },
            OR: [
              { keyword: { contains: stemForAtc } },
              { advertiserName: { contains: stemForAtc } },
            ],
          },
          select: {
            creativeId: true,
            youtubeId: true,
            ytViews: true,
            ytTitle: true,
            ytChannel: true,
            advertiserName: true,
            firstSeen: true,
          },
          orderBy: { ytViews: "desc" },
          take: 200,
        })
      : [];
  // Top 5 by view count for the brand summary card.
  const atcBrandSummary = {
    totalVideos: atcRows.length,
    totalViews: atcRows.reduce((s, a) => s + (a.ytViews ?? 0), 0),
    top5: atcRows.slice(0, 5).map((a) => ({
      youtubeId: a.youtubeId,
      title: a.ytTitle,
      channel: a.ytChannel,
      views: a.ytViews ?? 0,
      advertiser: a.advertiserName,
    })),
  };

  // 5. Pull the page roster for these brand keywords (MetaPage rows).
  const pages = await prisma.metaPage.findMany({
    where: { brandKeyword: { in: keywords } },
  });
  const uniquePageIds = new Set<string>();
  for (const a of uniqueAds) if (a.pageId) uniquePageIds.add(a.pageId);
  for (const p of pages) uniquePageIds.add(p.pageId);

  // 6. Concatenate logs (last 12 lines of each child) so the unified
  //    panel still surfaces what's happening per child job.
  const logs: string[] = [];
  for (const j of latestByKeyword.values()) {
    const lines = (j.logs ?? "").split("\n").filter(Boolean).slice(-12);
    if (lines.length > 0) {
      logs.push(`---- ${j.keyword} (${j.status}) ----`);
      for (const line of lines) logs.push(line);
    }
  }

  const parseArr = (s: string | null): string[] => {
    if (!s) return [];
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };

  return NextResponse.json({
    // Mimics JobDetail shape so MetaView can reuse DetailPane.
    id: `anchor:${anchor}`,
    keyword: anchor,
    region: "KR",
    status: bestStatus,
    adCount: uniqueAds.length,
    pageCount: uniquePageIds.size,
    errorMsg: null,
    // Anchor-specific extras — surfaced by MetaView when present.
    isAggregate: true,
    childKeywords: keywords,
    // Phase-2 enrichment progress for THIS anchor. UI polls the GET
    // endpoint to see the running counter without needing a separate
    // status route.
    enrichment: enrichRegistry.get(anchor) ?? null,
    // Brand-level Meta activity total (Σ "결과 ~N개" across child
    // watches). Surfaced in the aggregate banner — bigger number =
    // brand running a wider Meta operation right now.
    metaResultCountTotal: watches.reduce(
      (sum, w) => sum + (w.metaResultCount ?? 0),
      0
    ),
    // Phase-3b: brand-level ATC context (cross-platform reference).
    atcBrandSummary,
    childWatches: watches.map((w) => ({
      keyword: w.keyword,
      source: w.source,
      lastRunAt: w.lastRunAt,
      adCount: latestByKeyword.get(w.keyword)?.adCount ?? 0,
      status: latestByKeyword.get(w.keyword)?.status ?? null,
      metaResultCount: w.metaResultCount,
    })),
    ads: uniqueAds.map((a) => {
      const ytIds = adYtIds.get(a.adArchiveId) ?? [];
      const ytMatches = ytIds
        .map((id) => {
          const s = ytStats.get(id);
          if (!s) return null;
          return {
            youtubeId: id,
            ytViews: s.ytViews,
            ytTitle: s.ytTitle,
            ytChannel: s.ytChannel,
          };
        })
        .filter(
          (
            m
          ): m is {
            youtubeId: string;
            ytViews: number | null;
            ytTitle: string | null;
            ytChannel: string | null;
          } => m !== null
        );
      return {
        adArchiveId: a.adArchiveId,
        pageId: a.pageId,
        pageName: a.pageName,
        bodies: parseArr(a.bodies),
        linkTitles: parseArr(a.linkTitles),
        linkDescriptions: parseArr(a.linkDescriptions),
        linkCaptions: parseArr(a.linkCaptions),
        snapshotUrl: a.snapshotUrl,
        startTime: a.startTime,
        stopTime: a.stopTime,
        languages: parseArr(a.languages),
        publisherPlatforms: parseArr(a.publisherPlatforms),
        mediaUrl: a.mediaUrl,
        mediaType: a.mediaType,
        avatarUrl: a.avatarUrl,
        lpUrl: a.lpUrl,
        lpDomain: a.lpDomain,
        utmCampaign: a.utmCampaign,
        utmTerm: a.utmTerm,
        utmContent: a.utmContent,
        savedAt: a.savedAt,
        sourceKeyword: a.keyword,
        // === Scoring inputs ===
        // Variants of THIS ad's signature (body or lp) within the brand.
        // 1 = unique, ≥3 = brand iterating heavily on this angle.
        variantCount: sigCounts.get(sigOf(a)) ?? 1,
        // Highest matching ATC view count (Phase-3 cross-link). Null
        // when no YouTube id resolved to a row in our Ad table.
        ytMatches,
        ytTopViews: ytMatches.reduce(
          (m, x) => Math.max(m, x.ytViews ?? 0),
          0
        ),
        // Phase-2 Meta-direct signals (null librarySignalsFetchedAt =
        // never enriched). When metaVariantCount IS set, the score
        // function prefers it over the body-hash heuristic above.
        metaVariantCount: a.metaVariantCount,
        librarySignalsFetchedAt: a.librarySignalsFetchedAt,
        // Phase-3a: BIT.LY-resolved final URL + extracted YouTube id.
        resolvedLpUrl: a.resolvedLpUrl,
        resolvedLpDomain: a.resolvedLpDomain,
        resolvedYoutubeId: a.resolvedYoutubeId,
      };
    }),
    logs,
  });
}

/**
 * POST /api/meta/anchor/:anchor/  body: { action: "purge-noise" }
 *
 * Delete every ad under this anchor whose pageName / lpDomain doesn't
 * share the brand stem AND/OR is flagged as a sock-puppet (unicode
 * laundering, novel/drama/capital filler keywords). Used by the UI's
 * "🗑️ 무관 광고 일괄 삭제" button — meant for cases like example.co.kr
 * where Meta's full-text search returned 235 garbage matches.
 *
 * Returns the count of rows deleted plus the keys that survived.
 */
function brandStem(s: string): string {
  return s
    .replace(/^page:/, "")
    .replace(/\.(co\.kr|kr|com|net|io)$/i, "")
    .replace(/[^a-z0-9가-힣]/gi, "")
    .toLowerCase();
}

function looksSuspicious(s: string): boolean {
  if (!s) return false;
  if (/[lI1|]{4,}/.test(s)) return true;
  if (/[぀-ヿͰ-ϿЀ-ӿ\u{1F100}-\u{1FFFF}]/u.test(s)) return true;
  if (/\b(novel|reading|drama|memes|capital|chorki)\b/i.test(s)) return true;
  return false;
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { anchor: rawAnchor } = await params;
  const anchor = decodeURIComponent(rawAnchor);
  let body: { action?: string; refresh?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Resolve every keyword tied to this anchor — both purge-noise and
  // enrich-engagement need the same scope.
  const watches = await prisma.metaWatch.findMany({
    where: { OR: [{ keyword: anchor }, { anchorKeyword: anchor }] },
    select: { keyword: true },
  });
  const keywords = Array.from(new Set(watches.map((w) => w.keyword)));
  if (keywords.length === 0) {
    return NextResponse.json({ error: "anchor not found" }, { status: 404 });
  }

  if (body.action === "purge-noise") {
    const stem = brandStem(anchor);
    const ads = await prisma.metaAd.findMany({
      where: { keyword: { in: keywords } },
      select: {
        id: true,
        adArchiveId: true,
        pageName: true,
        lpDomain: true,
      },
    });
    const noiseIds: string[] = [];
    for (const a of ads) {
      const hay = `${a.pageName ?? ""} ${a.lpDomain ?? ""}`.toLowerCase();
      const offBrand = stem ? !hay.includes(stem) : false;
      const susp = looksSuspicious(a.pageName);
      if (offBrand || susp) noiseIds.push(a.id);
    }
    if (noiseIds.length === 0) {
      return NextResponse.json({ deleted: 0, surviving: ads.length });
    }
    await prisma.metaAd.deleteMany({ where: { id: { in: noiseIds } } });
    return NextResponse.json({
      deleted: noiseIds.length,
      surviving: ads.length - noiseIds.length,
    });
  }

  if (
    body.action === "enrich-engagement" ||
    body.action === "enrich-library-signals"
  ) {
    // Old action name kept for backward-compat with any saved UI state.
    // Don't double-start.
    const existing = enrichRegistry.get(anchor);
    if (existing && existing.status === "running") {
      return NextResponse.json(
        { ok: true, alreadyRunning: true, ...existing },
        { status: 200 }
      );
    }

    // Pick ads needing enrichment. Default: never-tried only (null
    // librarySignalsFetchedAt). refresh=true re-runs all.
    const ads = await prisma.metaAd.findMany({
      where: {
        keyword: { in: keywords },
        ...(body.refresh ? {} : { librarySignalsFetchedAt: null }),
      },
      select: { adArchiveId: true, keyword: true, lpUrl: true },
    });
    if (ads.length === 0) {
      return NextResponse.json({
        ok: true,
        nothingToEnrich: true,
        message: "이미 모든 광고 enrichment 완료. refresh=true 로 재시도 가능.",
      });
    }

    const progress: EnrichProgress = {
      status: "running",
      done: 0,
      total: ads.length,
      startedAt: Date.now(),
    };
    enrichRegistry.set(anchor, progress);

    void (async () => {
      try {
        const results = await batchFetchAdLibrarySignals(
          ads.map((a) => a.adArchiveId),
          {
            onProgress: (done) => {
              progress.done = done;
            },
          }
        );
        const now = new Date();
        // Persist per-ad metaVariantCount + librarySignalsFetchedAt
        // AND resolve LP redirects so we can cross-link to ATC
        // YouTube ads (BIT.LY → youtube.com/watch?v=…).
        const brandCountByKeyword = new Map<string, number>();
        for (const ad of ads) {
          const r = results.get(ad.adArchiveId);
          if (!r) continue;
          // Phase-3a: resolve LP redirects in-line. Each takes 0.5-3s,
          // sequentially batched so the user's machine isn't slammed.
          const resolved = await resolveAdLpUrl(ad.lpUrl);
          await prisma.metaAd
            .update({
              where: { adArchiveId: ad.adArchiveId },
              data: {
                metaVariantCount: r.metaVariantCount,
                librarySignalsFetchedAt: now,
                resolvedLpUrl: resolved.resolvedLpUrl,
                resolvedLpDomain: resolved.resolvedLpDomain,
                resolvedYoutubeId: resolved.resolvedYoutubeId,
              },
            })
            .catch(() => {});
          if (r.brandResultCount != null) {
            brandCountByKeyword.set(ad.keyword, r.brandResultCount);
          }
        }
        for (const [kw, count] of brandCountByKeyword) {
          await prisma.metaWatch
            .update({
              where: { keyword_region: { keyword: kw, region: "KR" } },
              data: { metaResultCount: count },
            })
            .catch(() => {});
        }
        progress.status = "done";
        progress.finishedAt = Date.now();
      } catch (e) {
        progress.status = "error";
        progress.error = e instanceof Error ? e.message : "unknown";
        progress.finishedAt = Date.now();
      }
    })();

    return NextResponse.json({
      ok: true,
      started: true,
      total: ads.length,
    });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
