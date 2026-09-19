/**
 * Direct HTTP-based YouTube ID + ad-text extractor.
 *
 * Replaces the previous Playwright approach (~6s per ad) with a plain
 * HTTP GET on the content.js URL embedded in each ATC ad (~0.2s per ad).
 *
 * Reverse-engineered from openclaw-ad-crawler-agency (the original site's
 * code): the trick is sending realistic browser headers (especially
 * `Referer: https://adstransparency.google.com/`) so Google's CDN serves
 * the JS without a 400. The response is the rendered creative's source
 * code, which we regex-mine for:
 *   - the YouTube video ID (4 patterns covering escaped/unescaped JS)
 *   - the ad headline / long headline / description text
 *   - a static preview image (for non-YouTube rich-media ads)
 *
 * Disk cache (24h TTL): content.js for a given creativeId basically
 * doesn't change while the campaign is live, so re-extracting the same
 * ad in repeat searches is free.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export type AdToCheck = {
  advertiserId: string;
  creativeId: string;
  /** content.js URL from SearchCreatives `3.1.4` — required for direct mode */
  previewUrl: string | null;
};

export type ExtractedAdInfo = {
  youtubeId: string | null;
  /** Best-effort static image (creative thumbnail) for non-YouTube ads */
  previewImage: string | null;
  /** Short ad headline (e.g. "10cm 더 자라는 비밀") */
  adHeadline: string | null;
  /** Optional long-form headline */
  adLongHeadline: string | null;
  /** Body description text */
  adDescription: string | null;
};

const EMPTY: ExtractedAdInfo = {
  youtubeId: null,
  previewImage: null,
  adHeadline: null,
  adLongHeadline: null,
  adDescription: null,
};

const CACHE_DIR = path.join(process.cwd(), "cache", "content-js");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheFilePath(url: string): string {
  const key = crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);
  return path.join(CACHE_DIR, `${key}.json`);
}

function readCache(url: string): ExtractedAdInfo | null {
  try {
    const file = cacheFilePath(url);
    if (!fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as ExtractedAdInfo;
  } catch {
    return null;
  }
}

function writeCache(url: string, info: ExtractedAdInfo) {
  try {
    ensureCacheDir();
    fs.writeFileSync(cacheFilePath(url), JSON.stringify(info));
  } catch {
    // ignore cache write failures
  }
}

// Browser fingerprint profiles — keyword-deterministic mapping makes
// repeat scrapes look like the same user instead of randomly different.
const PROFILES = [
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa:
      '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaPlatform: '"macOS"',
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    secChUa:
      '"Google Chrome";v="132", "Chromium";v="132", "Not_A Brand";v="24"',
    secChUaPlatform: '"macOS"',
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa:
      '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaPlatform: '"Windows"',
  },
];

function profileFor(seed: string) {
  const hash = crypto.createHash("sha256").update(seed).digest();
  return PROFILES[hash.readUInt32BE(0) % PROFILES.length];
}

const YT_ID_PATTERNS = [
  // JS-escaped string format: videoId\x27: \x27ABC\x27
  /videoId\\x27:\s*\\x27([a-zA-Z0-9_-]{11})\\x27/,
  // Unescaped: videoId: 'ABC' or videoId="ABC"
  /videoId['"]?\s*[:=]\s*['"]([a-zA-Z0-9_-]{11})['"]/,
  /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
];

function extractYouTubeId(text: string): string | null {
  for (const re of YT_ID_PATTERNS) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

function unescapeJs(s: string): string {
  return s
    .replace(/\\x27/g, "'")
    .replace(/\\x22/g, '"')
    .replace(/\\x3d/gi, "=")
    .replace(/\\x2f/gi, "/")
    .replace(/\\x3a/gi, ":")
    .replace(/\\x26/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\\\n/g, "\n")
    .replace(/\\n/g, " ")
    .trim();
}

function extractField(text: string, key: string): string | null {
  // Match \x27<key>\x27: \x27<value>\x27 where value's apostrophes are
  // also escaped — stop at the first un-escaped \x27.
  const re = new RegExp(
    `\\\\x27${key}\\\\x27:\\s*\\\\x27((?:[^\\\\]|\\\\(?!x27))*?)\\\\x27`
  );
  const m = text.match(re);
  if (!m) return null;
  const v = unescapeJs(m[1]);
  return v.length > 0 ? v : null;
}

const IMAGE_HOST_PATTERNS = [
  /https?:\/\/tpc\.googlesyndication\.com\/(?:archive\/)?simgad\/[\w-]+/g,
  /https?:\/\/[^/"'\s]*\.googleusercontent\.com\/[^"'\s]+\.(?:png|jpe?g|gif|webp)/gi,
];

function extractPreviewImage(text: string): string | null {
  for (const re of IMAGE_HOST_PATTERNS) {
    const matches = text.match(re);
    if (matches && matches.length > 0) {
      // Filter out obvious tracking pixels by URL pattern (1x1, beacon, etc.)
      const candidate = matches.find(
        (u) => !/1x1|pixel|beacon|track/i.test(u)
      );
      return candidate ?? matches[0];
    }
  }
  return null;
}

async function fetchContentJs(
  url: string,
  seed: string
): Promise<string | null> {
  const profile = profileFor(seed);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": profile.ua,
        Accept: "*/*",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        Referer: "https://adstransparency.google.com/",
        "Sec-Ch-Ua": profile.secChUa,
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": profile.secChUaPlatform,
        "Sec-Fetch-Dest": "script",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function extractAdInfoForOne(
  ad: AdToCheck
): Promise<ExtractedAdInfo> {
  if (!ad.previewUrl) return EMPTY;

  const cached = readCache(ad.previewUrl);
  if (cached) return cached;

  const text = await fetchContentJs(ad.previewUrl, ad.creativeId);
  if (!text) return EMPTY;

  const info: ExtractedAdInfo = {
    youtubeId: extractYouTubeId(text),
    previewImage: extractPreviewImage(text),
    adHeadline: extractField(text, "headline"),
    adLongHeadline: extractField(text, "longHeadline"),
    adDescription: extractField(text, "description"),
  };

  writeCache(ad.previewUrl, info);
  return info;
}

/**
 * Extract ad info for many ads in parallel. No browser, no Playwright —
 * just HTTP. Drop-in replacement for the old Playwright extractor.
 */
export async function extractAdInfoDirect(
  ads: AdToCheck[],
  options?: {
    concurrency?: number;
    onProgress?: (
      done: number,
      total: number,
      ytFound: number,
      imgFound: number
    ) => void;
  }
): Promise<Map<string, ExtractedAdInfo>> {
  const concurrency = options?.concurrency ?? 8;
  const onProgress = options?.onProgress;

  const results = new Map<string, ExtractedAdInfo>();
  let cursor = 0;
  let done = 0;
  let ytFound = 0;
  let imgFound = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= ads.length) return;
      const ad = ads[i];
      const info = await extractAdInfoForOne(ad);
      results.set(ad.creativeId, info);
      done++;
      if (info.youtubeId) ytFound++;
      if (info.previewImage) imgFound++;
      onProgress?.(done, ads.length, ytFound, imgFound);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, ads.length) }, () => worker())
  );

  return results;
}

/** For ad-hoc testing: returns cache hit/miss stats. */
export function getCacheStats(): { dir: string; files: number } {
  try {
    ensureCacheDir();
    return { dir: CACHE_DIR, files: fs.readdirSync(CACHE_DIR).length };
  } catch {
    return { dir: CACHE_DIR, files: 0 };
  }
}
