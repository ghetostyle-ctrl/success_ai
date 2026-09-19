/**
 * YouTube video ID extractor for ATC video ads.
 *
 * Strategy: visit each ad's detail page directly
 *   https://adstransparency.google.com/advertiser/{adId}/creative/{cId}?region=KR
 *
 * The detail page reliably loads the YouTube creative inside its iframe,
 * which fires network requests we can capture (youtube.com/embed/, ytimg.com).
 *
 * Tested on example-shop.com: matched 8/8 video ads with their YouTube IDs.
 *
 * Runs ad visits in parallel batches for speed.
 */
import { chromium, type Browser, type BrowserContext } from "playwright";

const YT_PATTERNS = [
  /youtube\.com\/(?:watch\?v=|embed\/|shorts\/)([\w-]{11})/g,
  /youtu\.be\/([\w-]{11})/g,
  /i\.ytimg\.com\/vi\/([\w-]{11})\//g,
  /googlevideo\.com\/.*?docid=([\w-]{11})/g,
];

// URL patterns for ad creative imagery served by Google's display CDNs
const IMAGE_HOST_PATTERNS = [
  /^https?:\/\/tpc\.googlesyndication\.com\/(?:archive\/)?simgad\/[\w-]+/i,
  /^https?:\/\/tpc\.googlesyndication\.com\/sadbundle\/[\w-]+\/[^?]+\.(?:png|jpe?g|gif|webp)/i,
  /^https?:\/\/[^/]*\.googleusercontent\.com\/.+\.(?:png|jpe?g|gif|webp)/i,
];

function extractIds(text: string): string[] {
  const out = new Set<string>();
  for (const re of YT_PATTERNS) {
    for (const m of text.matchAll(re)) out.add(m[1]);
  }
  return Array.from(out);
}

function isImageUrl(url: string): boolean {
  if (!url) return false;
  if (/youtube|ytimg|fonts|gstatic\.com\/images\/branding|google\.com\/images/i.test(url)) {
    return false;
  }
  for (const re of IMAGE_HOST_PATTERNS) {
    if (re.test(url)) return true;
  }
  return false;
}

export type AdToCheck = {
  advertiserId: string;
  creativeId: string;
};

export type ExtractedAdInfo = {
  /** YouTube video ID, if the ad turned out to be a YouTube video */
  youtubeId: string | null;
  /** Best-effort thumbnail URL for the rendered creative (image / rich media) */
  previewImage: string | null;
};

async function visitAdAndCapture(
  context: BrowserContext,
  ad: AdToCheck,
  region: string,
  perAdTimeoutMs: number,
  waitMs: number
): Promise<ExtractedAdInfo> {
  const page = await context.newPage();
  const ytIds = new Set<string>();
  const imageUrls: { url: string; size: number }[] = [];

  page.on("request", (req) => {
    const url = req.url();
    for (const id of extractIds(url)) ytIds.add(id);
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (!isImageUrl(url)) return;
    const len = parseInt(res.headers()["content-length"] ?? "0", 10);
    imageUrls.push({ url, size: len });
  });

  try {
    const url = `https://adstransparency.google.com/advertiser/${ad.advertiserId}/creative/${ad.creativeId}?region=${region}`;
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: perAdTimeoutMs,
    });
    await page.waitForTimeout(waitMs);
    const html = await page.content().catch(() => "");
    for (const id of extractIds(html)) ytIds.add(id);
  } catch {
    // ignore
  } finally {
    await page.close().catch(() => {});
  }

  const youtubeId = ytIds.size > 0 ? Array.from(ytIds)[0] : null;

  let previewImage: string | null = null;
  if (imageUrls.length > 0) {
    const candidates = imageUrls
      .filter((i) => i.size === 0 || i.size > 2000)
      .sort((a, b) => b.size - a.size);
    previewImage = candidates[0]?.url ?? imageUrls[0].url;
  }

  return { youtubeId, previewImage };
}

/**
 * Extract YouTube video IDs for a list of ads, mapped by creative ID.
 *
 * @param ads list of {advertiserId, creativeId} to check
 * @param options.region default "KR"
 * @param options.concurrency how many ads to fetch in parallel (default 4)
 * @param options.perAdTimeoutMs per-ad navigation timeout (default 12000)
 */
/**
 * Visit each ad's detail page and extract YouTube ID + preview image URL.
 * Returns Map<creativeId, ExtractedAdInfo>.
 *
 * IMPORTANT: each worker uses its OWN browser context (separate session),
 * because ATC throttles per-session — sharing one context across workers
 * caused most visits past the first 10 to silently fail to load YouTube
 * content within the wait window. Separate contexts = independent rate
 * budgets, near-100% hit rate.
 */
export async function extractAdInfo(
  ads: AdToCheck[],
  options?: {
    region?: string;
    concurrency?: number;
    perAdTimeoutMs?: number;
    waitMs?: number;
    onProgress?: (
      done: number,
      total: number,
      ytFound: number,
      imgFound: number
    ) => void;
  }
): Promise<Map<string, ExtractedAdInfo>> {
  const region = options?.region ?? "KR";
  const concurrency = options?.concurrency ?? 3;
  const perAdTimeoutMs = options?.perAdTimeoutMs ?? 20000;
  const waitMs = options?.waitMs ?? 6000;
  const onProgress = options?.onProgress;

  if (ads.length === 0) return new Map();

  const browser: Browser = await chromium.launch({ headless: true });
  try {
    const results = new Map<string, ExtractedAdInfo>();
    let cursor = 0;
    let done = 0;
    let ytFound = 0;
    let imgFound = 0;

    async function worker() {
      // Each worker gets its own context to avoid ATC's per-session
      // throttling collapsing concurrent visits.
      const context = await browser.newContext({
        locale: "ko-KR",
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      });
      try {
        while (true) {
          const i = cursor++;
          if (i >= ads.length) return;
          const ad = ads[i];
          const info = await visitAdAndCapture(
            context,
            ad,
            region,
            perAdTimeoutMs,
            waitMs
          );
          results.set(ad.creativeId, info);
          if (info.youtubeId) ytFound++;
          if (info.previewImage) imgFound++;
          done++;
          onProgress?.(done, ads.length, ytFound, imgFound);
        }
      } finally {
        await context.close().catch(() => {});
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, ads.length) },
      () => worker()
    );
    await Promise.all(workers);

    return results;
  } finally {
    await browser.close();
  }
}

/**
 * @deprecated Use extractAdInfo, which also returns preview images.
 */
export async function extractYouTubeIdsForAds(
  ads: AdToCheck[],
  options?: {
    region?: string;
    concurrency?: number;
    perAdTimeoutMs?: number;
    onProgress?: (done: number, total: number, found: number) => void;
  }
): Promise<Map<string, string>> {
  const onProgress = options?.onProgress;
  const info = await extractAdInfo(ads, {
    ...options,
    onProgress: onProgress
      ? (done, total, ytFound) => onProgress(done, total, ytFound)
      : undefined,
  });
  const ytOnly = new Map<string, string>();
  for (const [k, v] of info) {
    if (v.youtubeId) ytOnly.set(k, v.youtubeId);
  }
  return ytOnly;
}
