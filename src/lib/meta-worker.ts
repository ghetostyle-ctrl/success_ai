/**
 * In-process FIFO worker for Meta ad-library jobs. Mirrors the dissect
 * worker — one job at a time per Node process, fire-and-forget API
 * handshake, polling-friendly status writes.
 */
import { prisma } from "./db";
import { denseCollect } from "./meta-scraper";
import {
  denseCollectWeb,
  searchByPageIdWeb,
  fetchAdvertiserPageId,
} from "./meta-scraper-web";

// Mode switch — KR commercial ads via Graph API need a 1–3 day Meta
// identity verification, so the default until that lands is the
// public web UI scraped via Playwright. Flip META_MODE=graph in
// .env.local once your access token has the verified-advertiser
// flag set on it.
const META_MODE = (process.env.META_MODE || "web").toLowerCase();

// Persist queue + processing flag on globalThis so Next.js dev
// hot-reloads of this module don't drop in-flight work or duplicate
// the worker loop.
const g = globalThis as unknown as {
  __metaQueue?: string[];
  __metaProcessing?: boolean;
};
const queue: string[] = (g.__metaQueue ??= []);
function getProcessing() {
  return g.__metaProcessing ?? false;
}
function setProcessing(v: boolean) {
  g.__metaProcessing = v;
}

async function appendLog(id: string, line: string) {
  const row = await prisma.metaJob.findUnique({
    where: { id },
    select: { logs: true },
  });
  const merged = (row?.logs ?? "") + line + "\n";
  await prisma.metaJob.update({
    where: { id },
    data: { logs: merged.slice(-20000) },
  });
}

async function processOne(id: string) {
  const job = await prisma.metaJob.findUnique({ where: { id } });
  if (!job) return;
  await prisma.metaJob.update({
    where: { id },
    data: { status: "in_progress" },
  });

  const log = (line: string) => {
    const ts = new Date().toISOString().slice(11, 19);
    void appendLog(id, `[${ts}] ${line}`);
  };

  try {
    log(`mode=${META_MODE}`);
    // Page-id mode: queue API stores `page:<id>` so we know to skip the
    // search_terms stage and go straight to page-scoped scoop. This catches
    // ads operated under sock-puppet pages whose name doesn't include the
    // brand keyword (per the user's tip — same advertiser entity, different
    // running pages).
    let result: Awaited<ReturnType<typeof denseCollectWeb>>;
    if (job.keyword.startsWith("page:")) {
      const pageId = job.keyword.slice(5);
      log(`stage 1: direct page scoop pageId=${pageId}`);
      const ads = await searchByPageIdWeb(pageId, {
        maxScrolls: 30,
        onLog: log,
      });
      log(`  → ${ads.length} ads from page`);
      // Stage 1.5 lite for page mode: pull the advertiser entity off the
      // first ad so we surface sibling pages we wouldn't otherwise see.
      const discovered: string[] = [];
      if (ads.length > 0) {
        const r = await fetchAdvertiserPageId(ads[0].adArchiveId);
        if (r.pageId && r.pageId !== pageId) {
          log(`  page-mode: also found advertiser entity ${r.pageId}`);
          discovered.push(r.pageId);
        }
      }
      result = {
        ads,
        pages: [
          {
            pageId,
            pageName: ads[0]?.pageName || pageId,
            adsFromTerms: ads.length,
          },
        ],
        discoveredAdvertiserPageIds: discovered,
      };
    } else {
      const denseResult =
        META_MODE === "graph"
          ? await denseCollect(job.keyword, {
              maxPagesPerCall: 30,
              onLog: log,
            })
          : await denseCollectWeb(job.keyword, {
              maxScrolls: 30,
              onLog: log,
            });
      // denseCollect (Graph API path) doesn't surface advertiser entity ids
      // — graceful default to empty.
      const discovered: string[] =
        "discoveredAdvertiserPageIds" in denseResult &&
        Array.isArray(denseResult.discoveredAdvertiserPageIds)
          ? (denseResult.discoveredAdvertiserPageIds as string[])
          : [];
      result = {
        ads: denseResult.ads,
        pages: denseResult.pages,
        discoveredAdvertiserPageIds: discovered,
      };
    }

    // === Auto-evolution: register any newly seen advertiser entities ===
    // Same brand often runs ads under several advertiser pages. Once we
    // resolve a new one we want tomorrow's cron to scoop it without
    // anyone manually adding it to MetaWatch.
    // Determine the anchor brand for any auto-registrations: if this
    // job is a brand-keyword run, that keyword is the anchor; if it's
    // a page:* run, inherit the parent watch's anchorKeyword.
    let anchorForChildren: string | null = null;
    if (!job.keyword.startsWith("page:")) {
      anchorForChildren = job.keyword;
      // Ensure the brand-keyword itself is registered as a `seed`
      // MetaWatch row. Without this the anchor view (/api/meta/anchor/X)
      // can't find the keyword's own ads — it walks watches grouped by
      // anchorKeyword. One-shot scrapes via /api/meta/queue create a
      // job but no watch, leaving the ads stranded outside any anchor.
      await prisma.metaWatch
        .upsert({
          where: {
            keyword_region: { keyword: job.keyword, region: job.region },
          },
          create: {
            keyword: job.keyword,
            region: job.region,
            active: true,
            anchorKeyword: job.keyword,
            source: "seed",
            lastRunNote: "auto-seeded by worker",
          },
          update: {
            // If somehow the watch exists but with no anchorKeyword, fix it.
            anchorKeyword: job.keyword,
          },
        })
        .catch(() => {});
    } else {
      const parent = await prisma.metaWatch.findUnique({
        where: {
          keyword_region: { keyword: job.keyword, region: job.region },
        },
      });
      anchorForChildren = parent?.anchorKeyword ?? null;
    }

    for (const newPageId of result.discoveredAdvertiserPageIds) {
      const watchKey = `page:${newPageId}`;
      if (watchKey === job.keyword) continue;
      const existing = await prisma.metaWatch.findUnique({
        where: {
          keyword_region: { keyword: watchKey, region: job.region },
        },
      });
      if (!existing) {
        await prisma.metaWatch.create({
          data: {
            keyword: watchKey,
            region: job.region,
            active: true,
            anchorKeyword: anchorForChildren,
            source: "auto",
            lastRunNote: `auto-discovered from "${job.keyword}"`,
          },
        });
        log(
          `  🌱 auto-registered: ${watchKey} (anchor=${anchorForChildren ?? "?"})`
        );
      }
    }

    // Persist pages (brand → page roster).
    for (const p of result.pages) {
      await prisma.metaPage.upsert({
        where: { pageId: p.pageId },
        create: {
          pageId: p.pageId,
          pageName: p.pageName,
          brandKeyword: job.keyword,
          adsLastSeen: p.adsFromTerms,
        },
        update: {
          pageName: p.pageName,
          brandKeyword: job.keyword,
          adsLastSeen: p.adsFromTerms,
        },
      });
    }

    // === Brand-relevance guard ===
    // Brand-keyword scrapes (example.co.kr, example-shop, etc.) are routinely
    // polluted by Meta's full-text search returning sock-puppet drama
    // / capital / novel ads that happen to contain the keyword as a
    // substring. Drop them before they hit the DB. Page-id-mode jobs
    // skip this check — those ads are by definition the user's pinned
    // advertiser entity and trustworthy.
    const isPageMode = job.keyword.startsWith("page:");
    const stem = job.keyword
      .replace(/\.(co\.kr|kr|com|net|io)$/i, "")
      .replace(/[^a-z0-9가-힣]/gi, "")
      .toLowerCase();
    function looksSuspicious(s: string): boolean {
      if (!s) return false;
      if (/[lI1|]{4,}/.test(s)) return true;
      if (/[぀-ヿͰ-ϿЀ-ӿ\u{1F100}-\u{1FFFF}]/u.test(s)) return true;
      if (/\b(novel|reading|drama|memes|capital|chorki)\b/i.test(s)) return true;
      return false;
    }
    // Trust set: any page_id the user has already pinned as a watch
    // (page:XXX in MetaWatch) is by definition theirs to track, so we
    // skip the off-brand guard for those — even if the page name and
    // landing-page domain don't contain the keyword stem. This was the
    // brand-a.co.kr bug (May 2026): the operating page is "키즈 건강 꿀팁"
    // and the landing page goes through bit.ly, so neither hay component
    // contained "ihi". 366 legitimate ads were getting dropped.
    const watchPageIds = await prisma.metaWatch.findMany({
      where: { keyword: { startsWith: "page:" } },
      select: { keyword: true },
    });
    const trustedPageIds = new Set(
      watchPageIds.map((w) => w.keyword.slice(5))
    );
    const keywordLower = job.keyword.toLowerCase();
    const filteredAds = isPageMode
      ? result.ads
      : result.ads.filter((a) => {
          // (1) Pinned advertiser pages → trust unconditionally.
          if (a.pageId && trustedPageIds.has(a.pageId)) return true;
          // (2) Off-brand check across a wider hay: page name, landing
          // domain, AND ad copy fields. Catches shortened-link / sock-
          // puppet pages where the brand keyword only shows up in the
          // creative body or headline.
          const hay = [
            a.pageName ?? "",
            a.lpDomain ?? "",
            ...(a.bodies ?? []),
            ...(a.linkTitles ?? []),
            ...(a.linkDescriptions ?? []),
            ...(a.linkCaptions ?? []),
          ]
            .join(" ")
            .toLowerCase();
          if (stem && !hay.includes(stem) && !hay.includes(keywordLower)) {
            return false;
          }
          if (looksSuspicious(a.pageName)) return false;
          return true;
        });
    const droppedNoise = result.ads.length - filteredAds.length;
    if (droppedNoise > 0) {
      log(
        `  🛡️ brand-guard: dropped ${droppedNoise}/${result.ads.length} off-brand or sock-puppet ads`
      );
    }

    // Persist ads.
    for (const a of filteredAds) {
      const extra = {
        mediaUrl: a.mediaUrl ?? null,
        videoUrl: a.videoUrl ?? null,
        mediaType: a.mediaType ?? null,
        avatarUrl: a.avatarUrl ?? null,
        lpUrl: a.lpUrl ?? null,
        lpDomain: a.lpDomain ?? null,
        utmCampaign: a.utmCampaign ?? null,
        utmTerm: a.utmTerm ?? null,
        utmContent: a.utmContent ?? null,
      };
      await prisma.metaAd.upsert({
        where: { adArchiveId: a.adArchiveId },
        create: {
          adArchiveId: a.adArchiveId,
          pageId: a.pageId,
          pageName: a.pageName,
          bodies: JSON.stringify(a.bodies),
          linkTitles: JSON.stringify(a.linkTitles),
          linkDescriptions: JSON.stringify(a.linkDescriptions),
          linkCaptions: JSON.stringify(a.linkCaptions),
          snapshotUrl: a.snapshotUrl,
          startTime: a.startTime,
          stopTime: a.stopTime,
          languages: JSON.stringify(a.languages),
          publisherPlatforms: JSON.stringify(a.publisherPlatforms),
          region: job.region,
          keyword: job.keyword,
          jobId: job.id,
          ...extra,
        },
        update: {
          pageName: a.pageName,
          bodies: JSON.stringify(a.bodies),
          linkTitles: JSON.stringify(a.linkTitles),
          linkDescriptions: JSON.stringify(a.linkDescriptions),
          linkCaptions: JSON.stringify(a.linkCaptions),
          snapshotUrl: a.snapshotUrl,
          stopTime: a.stopTime,
          languages: JSON.stringify(a.languages),
          publisherPlatforms: JSON.stringify(a.publisherPlatforms),
          jobId: job.id,
          ...extra,
        },
      });
    }

    await prisma.metaJob.update({
      where: { id },
      data: {
        status: "complete",
        adCount: filteredAds.length,
        pageCount: result.pages.length,
      },
    });
    await appendLog(
      id,
      `[done] ads=${filteredAds.length} (${droppedNoise} dropped) pages=${result.pages.length}`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    await prisma.metaJob.update({
      where: { id },
      data: { status: "error", errorMsg: msg.slice(0, 500) },
    });
    await appendLog(id, `[error] ${msg.slice(0, 500)}`);
  }
}

async function pump() {
  if (getProcessing()) return;
  setProcessing(true);
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      await processOne(id);
    }
  } finally {
    setProcessing(false);
  }
}

export function enqueueMetaJob(id: string) {
  queue.push(id);
  void pump();
}

// Startup recovery: re-enqueue any rows still marked queued/in_progress
// from the previous process. Without this, a dev-server restart during
// a rescrape leaves N jobs orphaned in the DB. Runs once on first import
// of this module.
let recovered = false;
async function recoverPendingJobs() {
  if (recovered) return;
  recovered = true;
  try {
    const pending = await prisma.metaJob.findMany({
      where: { status: { in: ["queued", "in_progress"] } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    for (const j of pending) {
      // Reset in_progress → queued so the worker doesn't double-charge.
      await prisma.metaJob.update({
        where: { id: j.id },
        data: { status: "queued" },
      });
      queue.push(j.id);
    }
    if (pending.length > 0) {
      console.log(`[meta-worker] recovered ${pending.length} pending jobs`);
      void pump();
    }
  } catch (e) {
    console.error("[meta-worker] recovery failed:", e);
  }
}
void recoverPendingJobs();
