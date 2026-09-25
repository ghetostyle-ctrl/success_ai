/**
 * Playwright-based scraper for Meta's public Ad Library web UI.
 *
 * Why this exists alongside meta-scraper.ts:
 *   The Graph API /ads_archive endpoint requires Meta identity
 *   verification (1–3 day review + government ID upload) before
 *   commercial KR ads can be queried. The public web UI at
 *   facebook.com/ads/library/ has no such gate, so we drive a
 *   headless browser through it as a no-friction fallback.
 *
 * The HTML is React-rendered with obfuscated class names that change
 * frequently, so the locators below target stable text and href
 * patterns ("Library ID:", "/?id=", page-name links) rather than
 * css selectors. When this breaks, fix the text patterns — don't
 * reach for class names.
 *
 * Output shape mirrors meta-scraper.ts so downstream code (worker,
 * UI cards) doesn't care which path the data came from.
 */
import {
  chromium,
  type Browser,
  type Page,
  type LaunchOptions,
} from "playwright";
import { spawn } from "node:child_process";
import type { MetaScrapedAd } from "./meta-scraper";

const BASE = "https://www.facebook.com/ads/library/";

/**
 * chromium.launch wrapper that auto-applies PROXY_URL (IPRoyal residential)
 * when set. Without this, every browser request goes from the VM's
 * datacenter IP — Meta is more lenient than Google ATC but still rate-
 * limits aggressive scraping from cloud IPs over time.
 *
 * PROXY_URL format: http://user:pass@host:port (same as atc-scraper).
 * Playwright wants {server, username, password} split, so we parse.
 */
function parseProxyOption(): LaunchOptions["proxy"] | undefined {
  const url = process.env.PROXY_URL;
  if (!url) return undefined;
  const m = url.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+)$/);
  if (!m) return undefined;
  return {
    server: `${m[1]}${m[4]}`,
    username: m[2],
    password: m[3],
  };
}
async function launchChromium(extra?: LaunchOptions): Promise<Browser> {
  return chromium.launch({
    headless: true,
    proxy: parseProxyOption(),
    ...extra,
  });
}

/**
 * Polyfill installed via `ctx.addInitScript` before any page loads.
 *
 * Why: Next.js 16 + Turbopack name-mangles inner function declarations
 * in code passed to `page.evaluate` by wrapping them in
 * `__name(fn, "name")` calls (used for stack-trace naming in the dev
 * bundle). That helper exists in the Node bundle but not in the
 * browser context Playwright evaluates against, so every evaluate
 * blows up with `ReferenceError: __name is not defined`.
 *
 * Pass as a literal string so Turbopack can't rewrite it. Function
 * variants get re-mangled and reproduce the bug.
 */
const NAME_POLYFILL_SOURCE = `
  if (typeof window.__name !== "function") {
    window.__name = function (fn) { return fn; };
  }
`;

function buildUrl(params: {
  searchTerms?: string;
  pageId?: string;
  country?: string;
  activeStatus?: "all" | "active" | "inactive";
}): string {
  const u = new URL(BASE);
  u.searchParams.set("active_status", params.activeStatus ?? "all");
  u.searchParams.set("ad_type", "all");
  u.searchParams.set("country", params.country ?? "KR");
  if (params.searchTerms) u.searchParams.set("q", params.searchTerms);
  if (params.pageId) {
    u.searchParams.set("view_all_page_id", params.pageId);
    // When viewing all ads from a single page Meta drops the q param.
    u.searchParams.delete("q");
  }
  u.searchParams.set("media_type", "all");
  return u.toString();
}

async function dismissCookieBanner(page: Page) {
  // The cookie banner blocks scrolling on a fresh context. We don't
  // care which choice we make — pick the first big button that
  // mentions cookies/optional/decline, but fall through silently.
  try {
    const buttons = page.getByRole("button");
    const candidates = ["Decline optional cookies", "선택 사항인 쿠키 거부", "Reject all", "쿠키 거부"];
    for (const label of candidates) {
      const b = buttons.filter({ hasText: label }).first();
      if (await b.count()) {
        await b.click({ timeout: 2000 });
        await page.waitForTimeout(500);
        return;
      }
    }
  } catch {
    // ignore — page may not have a banner this session
  }
}

async function autoScroll(page: Page, opts: { maxScrolls: number; idleSettleMs: number }) {
  // Hard floor: do at least 6 scrolls before allowing the "page stopped
  // growing" exit. Meta's lazy-load is bursty — the SPA sometimes pauses
  // for 2~3 seconds between batches even when more cards are queued.
  // Bailing on the first stableTicks==2 was returning 0 ads on result
  // sets that actually had 40+ cards (brand-a.co.kr bug, May 2026).
  const MIN_SCROLLS = 6;
  // And require 4 consecutive idle ticks (not 2) before declaring the page
  // truly done. With idleSettleMs=2500 that's 10s of stillness — long
  // enough to outlast Meta's between-batch pauses.
  const STABLE_REQUIRED = 4;
  let lastHeight = 0;
  let stableTicks = 0;
  for (let i = 0; i < opts.maxScrolls; i++) {
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight)
    );
    await page.waitForTimeout(opts.idleSettleMs);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    if (h === lastHeight) {
      stableTicks++;
      if (i >= MIN_SCROLLS && stableTicks >= STABLE_REQUIRED) break;
    } else {
      stableTicks = 0;
      lastHeight = h;
    }
  }
}

/**
 * Pull every ad card currently in the DOM. Run this AFTER scrolling.
 *
 * The card is identified by the "Library ID: NNNN" text — Meta puts
 * exactly one of those per ad block. We walk up to that block's root
 * (the closest ancestor with `role="article"` or fallback) and pull
 * page name, body text, link, dates, and platform list off it.
 */
type ExtractedAd = {
  adArchiveId: string;
  pageId: string;
  pageName: string;
  body: string;
  linkTitle: string;
  linkDescription: string;
  startTime: string | null;
  stopTime: string | null;
  platforms: string[];
  mediaUrl: string | null;     // 600x600 creative image (or video poster)
  videoUrl: string | null;
  mediaType: "video" | "image"; // detected from <video> tag presence
  avatarUrl: string | null;    // 60x60 page avatar
  lpUrl: string | null;        // decoded destination URL (l.facebook.com → real domain)
  lpDomain: string | null;     // hostname of lpUrl
  utmCampaign: string | null;  // ad-unit identifier
  utmTerm: string | null;
  utmContent: string | null;
};

async function extractCards(page: Page): Promise<ExtractedAd[]> {
  return page.evaluate(() => {
    type ExtractedAd = {
      adArchiveId: string;
      pageId: string;
      pageName: string;
      body: string;
      linkTitle: string;
      linkDescription: string;
      startTime: string | null;
      stopTime: string | null;
      platforms: string[];
      mediaUrl: string | null;
      videoUrl: string | null;
      mediaType: "video" | "image";
      avatarUrl: string | null;
      lpUrl: string | null;
      lpDomain: string | null;
      utmCampaign: string | null;
      utmTerm: string | null;
      utmContent: string | null;
    };
    const out: ExtractedAd[] = [];

    // Walk: every card has a "Library ID:" / "라이브러리 ID:" text node
    // sitting in the card's footer. The card root is several ancestors
    // up — we need to climb until we hit a block that contains BOTH
    // the ID and a page link (= card header). That's the true root.
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    );
    const idNodes: Text[] = [];
    let n: Node | null = walker.nextNode();
    while (n) {
      const t = (n.textContent || "").trim();
      if (/^(?:Library ID|라이브러리 ID):\s*\d+/.test(t)) {
        idNodes.push(n as Text);
      }
      n = walker.nextNode();
    }

    const isPageLink = (a: HTMLAnchorElement): boolean => {
      const href = a.href || "";
      let u: URL;
      try {
        u = new URL(href);
      } catch {
        return false;
      }
      // Real page link: hostname must be the bare facebook.com (not the
      // `l.facebook.com` redirect host or any other subdomain).
      if (!/^(?:www\.)?facebook\.com$/i.test(u.hostname)) return false;
      // First path segment must be a username/page-id, not a utility route.
      if (
        /^\/(?:ads\/library|help|l\.php|sharer|policies|policy|tr|reg|login|recover)/i.test(
          u.pathname
        )
      )
        return false;
      // Empty path = home, also not a page.
      if (!u.pathname || u.pathname === "/") return false;
      return true;
    };

    const seen = new Set<string>();
    for (const idNode of idNodes) {
      const archiveMatch = (idNode.textContent || "").match(/(\d{5,})/);
      if (!archiveMatch) continue;
      const archiveId = archiveMatch[1];
      if (seen.has(archiveId)) continue;
      seen.add(archiveId);

      // Climb until we find an ancestor that ALSO contains a page-link
      // <a> tag — that ancestor is the card root.
      let block: HTMLElement | null = idNode.parentElement;
      let pageAnchor: HTMLAnchorElement | null = null;
      const MAX_CLIMB = 25;
      for (let i = 0; i < MAX_CLIMB && block && block.parentElement; i++) {
        const links = Array.from(
          block.querySelectorAll("a")
        ) as HTMLAnchorElement[];
        const hit = links.find(isPageLink);
        if (hit) {
          pageAnchor = hit;
          break;
        }
        block = block.parentElement;
      }
      if (!block) continue;

      // Page identity.
      let pageId = "";
      let pageName = "";
      if (pageAnchor) {
        const m = pageAnchor.href.match(
          /facebook\.com\/(?:profile\.php\?id=)?([\w.\-]+)/i
        );
        if (m) pageId = m[1];
        pageName = (pageAnchor.textContent || "").trim();
      }

      // Body — the longest visible text within the card root that
      // isn't header chrome. Look at leaf text nodes and merge.
      const skipTexts = new Set<string>();
      [
        "활성",
        "Active",
        "Inactive",
        "비활성",
        "Sponsored",
        "광고",
        "여러 버전이 있는 광고입니다",
        "More versions of this ad",
        "Open Drop-down",
        "드롭다운 열기",
      ].forEach((s) => skipTexts.add(s));

      const isJunk = (t: string) => {
        if (!t) return true;
        if (t.length < 4) return true;
        if (skipTexts.has(t)) return true;
        if (/^(?:Library ID|라이브러리 ID|플랫폼|Platforms?):/i.test(t)) return true;
        if (/^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/.test(t)) return true; // date
        if (/^Started running|^게재 시작|에 게재 시작함$/.test(t)) return true;
        if (t === pageName) return true;
        return false;
      };

      const fragments: string[] = [];
      const tw = document.createTreeWalker(
        block,
        NodeFilter.SHOW_TEXT
      );
      let leaf: Node | null = tw.nextNode();
      while (leaf) {
        const t = (leaf.textContent || "").replace(/\s+/g, " ").trim();
        if (!isJunk(t)) fragments.push(t);
        leaf = tw.nextNode();
      }
      // Dedupe & merge into one body string.
      const dedup: string[] = [];
      for (const f of fragments) {
        if (dedup.length && dedup[dedup.length - 1] === f) continue;
        dedup.push(f);
      }
      let body = dedup.join(" ").replace(/\s+/g, " ").trim();
      if (body.length > 800) body = body.slice(0, 800);

      // Dates — handle Korean "2026. 4. 15.에 게재 시작함" form too.
      const text = (block.textContent || "").replace(/\s+/g, " ");
      let startTime: string | null = null;
      const krStart = text.match(
        /(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.)\s*에 게재 시작함/
      );
      const enStart = text.match(
        /Started running on ([A-Za-z]+ \d{1,2},? \d{4})/
      );
      if (krStart) startTime = krStart[1];
      else if (enStart) startTime = enStart[1];

      let stopTime: string | null = null;
      const krStop = text.match(
        /(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.)\s*까지 게재됨|비활성[^\d]*(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.)/
      );
      if (krStop) stopTime = krStop[1] || krStop[2] || null;

      // Platform icons. Meta uses a shared CSS sprite — every platform
      // glyph has the same mask-image but different mask-position.
      // We can't decode which platform without a lookup table, but the
      // count of distinct mask-positions == number of platforms.
      const platMasks = new Set<string>();
      const platformLabel = block.querySelector(
        "[class*='x1xegmmw']"
      );
      // Look for the "플랫폼" label container & sibling glyphs.
      const platSection = (() => {
        // Find a span containing "플랫폼" or "Platforms"
        for (const el of block.querySelectorAll("span")) {
          const t = (el.textContent || "").trim();
          if (t === "플랫폼" || t === "Platforms" || t === "Platform") {
            return el.parentElement;
          }
        }
        return null;
      })();
      if (platSection) {
        for (const el of platSection.querySelectorAll('[style*="mask-position"]')) {
          const styleAttr = el.getAttribute("style") || "";
          const m = styleAttr.match(/mask-position:\s*([^;]+)/);
          if (m) platMasks.add(m[1].trim());
        }
      }
      // Voiceover labels — sometimes Meta does annotate accessibly.
      // 한국어 ad library 페이지는 aria-label 도 한글로 옴 → 한/영 둘다.
      // 매칭 실패 시 fallback="PLATFORM_x" placeholder 가 UI 에 노출되는
      // 문제가 있었음 (2026-06-24).
      const platsNamed = new Set<string>();
      for (const el of block.querySelectorAll("[aria-label], [title]")) {
        const lbl =
          (el.getAttribute("aria-label") || el.getAttribute("title") || "")
            .toLowerCase();
        if (/facebook|페이스북|페북/.test(lbl)) platsNamed.add("FACEBOOK");
        if (/instagram|인스타그램|인스타/.test(lbl)) platsNamed.add("INSTAGRAM");
        if (/messenger|메신저/.test(lbl)) platsNamed.add("MESSENGER");
        if (/audience network|오디언스 ?네트워크/.test(lbl))
          platsNamed.add("AUDIENCE_NETWORK");
        if (/threads|스레드/.test(lbl)) platsNamed.add("THREADS");
      }
      const platforms =
        platsNamed.size > 0
          ? Array.from(platsNamed)
          : Array.from(platMasks).map((_, i) => `PLATFORM_${i + 1}`);

      // Suppress unused-variable warning while keeping the locator
      // around for future tuning.
      void platformLabel;

      // === Media + LP extraction (sized fbcdn URLs + l.facebook.com decode) ===
      // Page avatar: small 60x60 sprite. Creative image: 600x600.
      // 카드 안 fbcdn 이미지 중 가장 큰 것 = 크리에이티브 썸네일.
      // avatar 는 60px(naturalWidth) 라 자동 제외되고, 크리에이티브는
      // 320~576px+. _s60x60_tt6 suffix 도 avatar 로 분류. naturalWidth
      // 기준이라 size-suffix 가 바뀌어도(video poster 등) 안정적.
      let avatarUrl: string | null = null;
      let mediaUrl: string | null = null;
      let bestW = 0;
      for (const imgEl of block.querySelectorAll("img")) {
        const img = imgEl as HTMLImageElement;
        const src = img.src || "";
        if (!src || !/scontent[^\s"]+\.fbcdn\.net/.test(src)) continue;
        const w = img.naturalWidth || 0;
        if (/_s60x60_tt6/.test(src) || w <= 100) {
          if (!avatarUrl) avatarUrl = src; // 작은 건 avatar 후보
          continue;
        }
        if (w > bestW) {
          bestW = w;
          mediaUrl = src;
        }
      }
      // 큰 이미지를 못 찾았으면(전부 100px 이하) 마지막 수단으로 avatar 외
      // 첫 fbcdn 이미지.
      if (!mediaUrl) {
        for (const imgEl of block.querySelectorAll("img")) {
          const src = (imgEl as HTMLImageElement).src || "";
          if (/scontent[^\s"]+\.fbcdn\.net/.test(src) && src !== avatarUrl) {
            mediaUrl = src;
            break;
          }
        }
      }

      // === mediaType detection ===
      // Three independent signals — any one is enough to flag video:
      //   1. <video> tag inside the card (most reliable; 8/8 in dump)
      //   2. aria-label="동영상 재생" / "Video player" / "재생" / "Play video"
      //   3. <video poster> attr present
      // If none of those match, treat as image. We also prefer a video
      // poster URL over the static fbcdn image when both exist — the
      // poster is the actual creative thumbnail Meta shows in-card.
      const videoEl = block.querySelector("video") as HTMLVideoElement | null;
      let hasVideoSignal = !!videoEl;
      if (!hasVideoSignal) {
        for (const el of block.querySelectorAll("[aria-label]")) {
          const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
          if (
            /동영상 재생|video player|재생|play video/i.test(lbl) &&
            !/audio|sound/i.test(lbl)
          ) {
            hasVideoSignal = true;
            break;
          }
        }
      }
      if (videoEl?.poster) mediaUrl = videoEl.poster;
      const candidateVideoUrl = videoEl?.currentSrc || videoEl?.src ||
        videoEl?.querySelector("source")?.src || "";
      const videoUrl = /^https:\/\//i.test(candidateVideoUrl)
        ? candidateVideoUrl
        : null;
      const mediaType: "video" | "image" = hasVideoSignal ? "video" : "image";

      // Destination URL — Meta wraps every outbound click in
      // l.facebook.com/l.php?u=<percent-encoded-real-url>. Decode it
      // so we surface the real LP domain (example-shop.com/...) and pull
      // out the UTM-campaign/term/content tags that identify each ad
      // unit on the customer's analytics side.
      let lpUrl: string | null = null;
      let lpDomain: string | null = null;
      let utmCampaign: string | null = null;
      let utmTerm: string | null = null;
      let utmContent: string | null = null;
      for (const a of block.querySelectorAll("a")) {
        const href = (a as HTMLAnchorElement).href || "";
        if (!/l\.facebook\.com\/l\.php\?u=/.test(href)) continue;
        try {
          const u = new URL(href);
          const real = u.searchParams.get("u");
          if (!real) continue;
          const decoded = decodeURIComponent(real);
          lpUrl = decoded;
          const ru = new URL(decoded);
          lpDomain = ru.hostname.replace(/^www\./, "");
          utmCampaign = ru.searchParams.get("utm_campaign");
          utmTerm = ru.searchParams.get("utm_term");
          utmContent = ru.searchParams.get("utm_content");
          break;
        } catch {
          // bad URL, keep looking
        }
      }
      // Fallback: any plain <a> targeting an external (non-facebook) host.
      if (!lpUrl) {
        for (const a of block.querySelectorAll("a")) {
          const href = (a as HTMLAnchorElement).href || "";
          try {
            const u = new URL(href);
            if (!/facebook\.com$/.test(u.hostname) && !/^l\.facebook/.test(u.hostname)) {
              lpUrl = href;
              lpDomain = u.hostname.replace(/^www\./, "");
              utmCampaign = u.searchParams.get("utm_campaign");
              utmTerm = u.searchParams.get("utm_term");
              utmContent = u.searchParams.get("utm_content");
              break;
            }
          } catch {
            // ignore
          }
        }
      }

      out.push({
        adArchiveId: archiveId,
        pageId,
        pageName,
        body,
        linkTitle: "",
        linkDescription: "",
        startTime,
        stopTime,
        platforms,
        mediaUrl,
        videoUrl,
        mediaType,
        avatarUrl,
        lpUrl,
        lpDomain,
        utmCampaign,
        utmTerm,
        utmContent,
      });
    }
    return out;
  });
}

function toScrapedAd(e: ExtractedAd): MetaScrapedAd {
  return {
    adArchiveId: e.adArchiveId,
    pageId: e.pageId,
    pageName: e.pageName,
    bodies: e.body ? [e.body] : [],
    linkTitles: e.linkTitle ? [e.linkTitle] : [],
    linkDescriptions: e.linkDescription ? [e.linkDescription] : [],
    linkCaptions: [],
    snapshotUrl: null,
    startTime: e.startTime,
    stopTime: e.stopTime,
    languages: [],
    publisherPlatforms: e.platforms,
    mediaUrl: e.mediaUrl,
    videoUrl: e.videoUrl,
    mediaType: e.mediaType,
    avatarUrl: e.avatarUrl,
    lpUrl: e.lpUrl,
    lpDomain: e.lpDomain,
    utmCampaign: e.utmCampaign,
    utmTerm: e.utmTerm,
    utmContent: e.utmContent,
  };
}

export async function searchByTermsWeb(
  terms: string,
  options?: {
    country?: string;
    maxScrolls?: number;
    onLog?: (line: string) => void;
  }
): Promise<MetaScrapedAd[]> {
  const log = (m: string) => options?.onLog?.(m);
  const url = buildUrl({ searchTerms: terms, country: options?.country });
  return scrapeUrl(url, options?.maxScrolls ?? 30, log);
}

export async function searchByPageIdWeb(
  pageId: string,
  options?: {
    country?: string;
    maxScrolls?: number;
    onLog?: (line: string) => void;
  }
): Promise<MetaScrapedAd[]> {
  const log = (m: string) => options?.onLog?.(m);
  const url = buildUrl({ pageId, country: options?.country });
  return scrapeUrl(url, options?.maxScrolls ?? 30, log);
}

// Network errors that justify a retry — Mac sleep/wake, brief Wi-Fi
// drop, DNS hiccup, transient TLS handshake failure. Permanent issues
// (404, bot challenge) don't match these patterns.
const TRANSIENT_NET_PATTERNS = [
  /ERR_INTERNET_DISCONNECTED/i,
  /ERR_NAME_NOT_RESOLVED/i,
  /ERR_NETWORK_CHANGED/i,
  /ERR_CONNECTION_RESET/i,
  /ERR_CONNECTION_TIMED_OUT/i,
  /ERR_PROXY_CONNECTION_FAILED/i,
  /Timeout \d+ms exceeded/i,
];

function isTransientNetError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return TRANSIENT_NET_PATTERNS.some((p) => p.test(msg));
}

async function scrapeUrl(
  url: string,
  maxScrolls: number,
  log: (m: string) => void
): Promise<MetaScrapedAd[]> {
  // Up to 3 attempts on transient network errors. Backoff 10s → 30s.
  // The night-time cron runs while Mac may briefly drop Wi-Fi (sleep/
  // wake, dhcp renewal). Without retry, one packet loss kills the whole
  // brand watch and surfaces as ❌ in the sidebar.
  const attempts = 3;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await scrapeUrlOnce(url, maxScrolls, log);
    } catch (e) {
      lastErr = e;
      if (!isTransientNetError(e) || attempt === attempts) {
        throw e;
      }
      const wait = attempt === 1 ? 10_000 : 30_000;
      log(`  ⚠️ network error (attempt ${attempt}/${attempts}): ${e instanceof Error ? e.message.slice(0, 80) : "unknown"}`);
      log(`  retrying in ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr ?? new Error("scrapeUrl exhausted retries");
}

async function scrapeUrlOnce(
  url: string,
  maxScrolls: number,
  log: (m: string) => void
): Promise<MetaScrapedAd[]> {
  log(`launch headless chromium → ${url.slice(0, 80)}...`);
  const browser: Browser = await launchChromium();
  try {
    const ctx = await browser.newContext({
      locale: "ko-KR",
      viewport: { width: 1366, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    // === Bandwidth diet ===
    // Block ONLY font + stylesheet. 디버그로 확인: media(video) 를 차단하면
    // facebook 이 video 광고의 크리에이티브 썸네일(576px poster) 을 아예
    // 렌더하지 않아 카드에 avatar(60px) 만 남고 mediaUrl 추출이 30%로 떨어짐.
    // media 허용 시 576px 썸네일 img 가 로드됨. 큰 .mp4 본 파일은 실제로
    // 재생 안 하면 안 받으므로(poster 만 표시) 트래픽 부담은 제한적.
    // font/stylesheet 만 차단. media(video) 까지 막으면 facebook 이
    // video 광고의 576px poster 썸네일을 렌더하지 않아 mediaUrl 추출이
    // 96%→31% 로 추락(검증 완료). poster 가 video 스트림에 묶여 있어
    // .mp4 만 골라 막아도 썸네일이 사라진다. 썸네일 우선 → media 허용.
    // 트래픽 ~200MB/scrape 지만 메타는 수동 수집(사용자가 🔄 누른
    // brand 만)이라 자동 누적은 없다.
    await ctx.route("**/*", (route, request) => {
      const t = request.resourceType();
      if (t === "font" || t === "stylesheet") {
        route.abort();
      } else {
        route.continue();
      }
    });
    // Turbopack name-mangles inner functions inside `page.evaluate(() => {...})`
    // into wrappers that call `__name(fn, "name")` for stack traces. The
    // polyfill below installs a no-op so the page context doesn't blow
    // up with `ReferenceError: __name is not defined`.
    await ctx.addInitScript({ content: NAME_POLYFILL_SOURCE });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Cookie banner는 의도적으로 무시 — 한국 IP + ko-KR locale 에서 우리
    // dismiss 로직이 가끔 검색 결과 페이지로 navigation을 트리거해서 카드 0
    // 으로 떨어지는 사례 확인. probe 결과 banner 무시해도 카드 수집은
    // 정상이라 그냥 두는 게 안전. (필요시 banner click 안 한 채 직접
    // overlay z-index 무시하고 스크롤 가능.)
    // await dismissCookieBanner(page);
    // Initial render — wait for the FIRST card to appear in DOM, then
    // give Meta's SPA an extra moment to settle. Without the
    // waitForFunction we used to time-box at 5s and start scrolling
    // before any cards rendered — autoScroll then saw a static (empty)
    // page height, hit stableTicks early, and extracted 0 cards on
    // result sets that actually had 40+ ads (brand-a.co.kr bug, May 2026).
    try {
      await page.waitForFunction(
        () => /라이브러리 ID|Library ID/.test(document.body?.innerText || ""),
        { timeout: 20_000 }
      );
    } catch {
      // No cards appeared in 20s — could be a genuinely empty result OR
      // a rate-limit page. Either way, fall through to extractCards
      // which will return 0 cleanly. Don't throw.
    }
    await page.waitForTimeout(2_000);
    log(`scrolling (max ${maxScrolls} ticks)`);
    // idleSettleMs bumped 1500 → 2500: Meta's lazy-load batches arrive
    // every ~2s on slower proxy paths; 1500 was racing the network and
    // declaring the page idle before the next batch arrived.
    await autoScroll(page, { maxScrolls, idleSettleMs: 2500 });
    // 썸네일 lazy-load 트리거 — autoScroll 은 scrollHeight 로 점프해서
    // 중간 카드가 viewport 를 통과하지 않아 이미지(IntersectionObserver
    // lazy)가 로드 안 됨 → mediaUrl 추출률 30%대. 위→아래로 한 화면씩
    // 점진 스크롤해 모든 카드를 한 번씩 viewport 에 넣어 <img src> 가
    // 채워지게 한다. (이미지는 route 에서 허용됨)
    log(`lazy 썸네일 로드 (점진 스크롤)`);
    await page.evaluate(async () => {
      const step = Math.floor(window.innerHeight * 0.85);
      const h = document.documentElement.scrollHeight;
      for (let y = 0; y <= h; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 250));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1500); // 마지막 배치 이미지 로드 여유
    log(`extracting cards`);
    const extracted = await extractCards(page);
    log(`got ${extracted.length} ads`);
    return extracted.map(toScrapedAd);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Pull the advertiser entity page_id off a single ad's detail page.
 *
 * Anonymous curl fetch returns a redirect-only stub (~500 bytes), so
 * we drive a headless Chromium that loads the full SPA. The HTML
 * Meta delivers there contains the inlined GraphQL response:
 *
 *   "deeplink_ad_archive":{"ad_archive_id":"...","page_id":"<advertiser>",...}
 *
 * The `page_id` value here is the long-form (15-digit) advertiser
 * entity — the same number a user sees in `view_all_page_id=...` URLs
 * when copy-pasting a sock-puppet ad-library link. Different from
 * the 11-digit running page id we extract off cards. Crucial for
 * surfacing brand-sibling pages the user never search-typed for.
 */
export async function fetchAdvertiserPageId(
  adArchiveId: string,
  options?: { browser?: import("playwright").Browser }
): Promise<{ pageId: string | null; runningPageId: string | null }> {
  const url = `https://www.facebook.com/ads/library/?id=${adArchiveId}`;
  const ownsBrowser = !options?.browser;
  const browser = options?.browser ?? (await launchChromium());
  let ctx: import("playwright").BrowserContext | null = null;
  try {
    ctx = await browser.newContext({
      locale: "ko-KR",
      viewport: { width: 1366, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    await ctx.addInitScript({ content: NAME_POLYFILL_SOURCE });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(3500);
    const html = await page.content();
    const m = html.match(
      /"deeplink_ad_archive"\s*:\s*\{[^]{0,200}?"page_id"\s*:\s*"(\d+)"/
    );
    // Running page id = the 11-digit numeric in page_profile_uri.
    const r = html.match(
      /"page_profile_uri"\s*:\s*"https:\\\/\\\/www\.facebook\.com\\\/(\d+)\\?\/?"/
    );
    return {
      pageId: m?.[1] ?? null,
      runningPageId: r?.[1] ?? null,
    };
  } catch {
    return { pageId: null, runningPageId: null };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    if (ownsBrowser) await browser.close().catch(() => {});
  }
}

/**
 * Phase-3a: resolve a (likely shortened) ad LP URL to its final
 * destination + extract a YouTube video id when present.
 *
 * Direct-response Meta ads land on shorteners (BIT.LY, brand-b.co.kr,
 * t.co, lnk.to, naver.me, etc.) and we need the final URL to:
 *   - cross-link to ATC YouTube ad data via youtubeId
 *   - know the actual destination domain (LP analytics)
 *
 * Strategy: HEAD with -L follows redirects, prints final URL via
 * `-w "%{url_effective}"`. Falls back to GET if HEAD is blocked
 * (some shorteners reject HEAD).
 */
const SHORTENER_HOSTS = new Set([
  "bit.ly",
  "t.co",
  "lnk.to",
  "naver.me",
  "me2.do",
  "buly.kr",
  "han.gl",
  "brand-b.co.kr",
  "aka.ms",
  "rb.gy",
  "tinyurl.com",
  "vo.la",
  "url.kr",
]);

function extractYoutubeId(url: string): string | null {
  // Standard /watch?v=, youtu.be/, /shorts/, /embed/.
  const m = url.match(
    /(?:youtu\.be\/|\/watch\?v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/
  );
  return m?.[1] ?? null;
}

function isShortener(url: string | null): boolean {
  if (!url) return false;
  try {
    return SHORTENER_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function curlResolve(
  url: string,
  timeoutSec = 10
): Promise<{ finalUrl: string; status: number } | null> {
  return new Promise((resolve) => {
    const args = [
      "-sIL", // HEAD with redirect follow
      "-o",
      "/dev/null",
      "-w",
      "%{url_effective}\\n%{http_code}",
      "--connect-timeout",
      "5",
      "--max-time",
      String(timeoutSec),
      "--user-agent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      url,
    ];
    const cp = spawn("curl", args);
    let out = "";
    cp.stdout.on("data", (d) => (out += d.toString()));
    cp.on("close", (code) => {
      if (code !== 0) return resolve(null);
      const lines = out.trim().split("\n");
      const finalUrl = lines[0];
      const status = parseInt(lines[1] ?? "0", 10);
      if (!finalUrl) return resolve(null);
      resolve({ finalUrl, status });
    });
    cp.on("error", () => resolve(null));
  });
}

export async function resolveAdLpUrl(
  lpUrl: string | null
): Promise<{
  resolvedLpUrl: string | null;
  resolvedLpDomain: string | null;
  resolvedYoutubeId: string | null;
}> {
  if (!lpUrl) {
    return {
      resolvedLpUrl: null,
      resolvedLpDomain: null,
      resolvedYoutubeId: null,
    };
  }
  // Skip resolution for URLs that are already on a known content host
  // — saves time + avoids hitting the brand's own server unnecessarily.
  // We only resolve when it looks like a shortener OR a redirector.
  const original = lpUrl;
  let needsResolve = isShortener(original);
  if (!needsResolve) {
    // Check for query-param redirectors like l.facebook.com/?u=
    try {
      const u = new URL(original);
      if (u.searchParams.has("u") || u.searchParams.has("url")) {
        needsResolve = true;
      }
    } catch {
      // ignored
    }
  }
  // If the URL ALREADY contains a YouTube id, no need to resolve.
  const directYt = extractYoutubeId(original);
  if (directYt) {
    let domain: string | null = null;
    try {
      domain = new URL(original).hostname.toLowerCase();
    } catch {
      // ignored
    }
    return {
      resolvedLpUrl: original,
      resolvedLpDomain: domain,
      resolvedYoutubeId: directYt,
    };
  }
  if (!needsResolve) {
    let domain: string | null = null;
    try {
      domain = new URL(original).hostname.toLowerCase();
    } catch {
      // ignored
    }
    return {
      resolvedLpUrl: original,
      resolvedLpDomain: domain,
      resolvedYoutubeId: null,
    };
  }
  const r = await curlResolve(original);
  if (!r) {
    return {
      resolvedLpUrl: original,
      resolvedLpDomain: null,
      resolvedYoutubeId: null,
    };
  }
  let domain: string | null = null;
  try {
    domain = new URL(r.finalUrl).hostname.toLowerCase();
  } catch {
    // ignored
  }
  return {
    resolvedLpUrl: r.finalUrl,
    resolvedLpDomain: domain,
    resolvedYoutubeId: extractYoutubeId(r.finalUrl),
  };
}

/**
 * Phase-2 library-signals enrichment.
 *
 * Engagement (likes/comments/shares) is intentionally not exposed by
 * Meta in the public Ad Library for KR commercial ads. What IS exposed
 * and useful for A-tier scoring:
 *
 *   1. metaVariantCount — Meta's own count of "광고 N개에서 이
 *      크리에이티브 및 문구를 사용합니다", visible per ad. Replaces
 *      our body-hash variant heuristic with the true number.
 *
 *   2. brandResultCount — "결과 ~N개" at the top of the page. The
 *      total number of ads Meta is currently surfacing for this brand
 *      keyword. Captures absolute Meta activity volume regardless of
 *      how many we successfully deduped into MetaAd.
 */
function parseLooseInt(s: string): number | null {
  const m = s.replace(/[,\s]/g, "").match(/^\d+$/);
  return m ? Number(m[0]) : null;
}

export async function fetchAdLibrarySignals(
  adArchiveId: string,
  options?: { browser?: import("playwright").Browser }
): Promise<{
  metaVariantCount: number | null;
  brandResultCount: number | null;
}> {
  const url = `https://www.facebook.com/ads/library/?id=${adArchiveId}`;
  const ownsBrowser = !options?.browser;
  const browser =
    options?.browser ?? (await launchChromium());
  let ctx: import("playwright").BrowserContext | null = null;
  try {
    ctx = await browser.newContext({
      locale: "ko-KR",
      viewport: { width: 1366, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    await ctx.addInitScript({ content: NAME_POLYFILL_SOURCE });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(4500);
    const text = await page.evaluate(() => document.body.innerText);

    // 1. Variant count — find the FIRST occurrence near our ad's
    // library id to avoid grabbing a sibling ad's number. Meta lists
    // multiple ads on the same page; "?id=X" centers on X but the
    // surrounding ads also render. We anchor to "라이브러리 ID: X".
    let metaVariantCount: number | null = null;
    const idAnchor = text.indexOf(`라이브러리 ID: ${adArchiveId}`);
    if (idAnchor >= 0) {
      // Search within ~600 chars after our ad's anchor for the
      // variant text. If we find another 라이브러리 ID first, the
      // variant text isn't ours.
      const slice = text.slice(idAnchor, idAnchor + 600);
      const nextAnchor = slice.indexOf(
        "라이브러리 ID:",
        20 // skip our own anchor (after the colon)
      );
      const scope = nextAnchor > 0 ? slice.slice(0, nextAnchor) : slice;
      const m = scope.match(
        /광고\s*(\d+)\s*개에서\s*이\s*크리에이티브/
      );
      if (m) metaVariantCount = parseLooseInt(m[1]);
    }
    // Fallback when our id wasn't found in body: most ads with no
    // fan-out simply don't print the line, so absence = 1 (unique).
    if (metaVariantCount === null && idAnchor >= 0) metaVariantCount = 1;

    // 2. Brand result count — single occurrence at top. Pattern:
    //    "결과 ~16개" or "~16 results" depending on locale.
    let brandResultCount: number | null = null;
    const krResult = text.match(/결과\s*[~약]?\s*(\d{1,5})\s*개/);
    if (krResult) brandResultCount = parseLooseInt(krResult[1]);
    else {
      const enResult = text.match(/[~about]?\s*(\d{1,5})\s+results?/i);
      if (enResult) brandResultCount = parseLooseInt(enResult[1]);
    }

    return { metaVariantCount, brandResultCount };
  } catch {
    return { metaVariantCount: null, brandResultCount: null };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    if (ownsBrowser) await browser.close().catch(() => {});
  }
}

/**
 * Batch helper — reuse one browser process across many ads. Sequential
 * (concurrency=1) to keep the user's machine responsive; the snapshot
 * pages are heavy enough that parallel contexts thrash CPU.
 */
export async function batchFetchAdLibrarySignals(
  adArchiveIds: string[],
  options?: {
    onLog?: (line: string) => void;
    onProgress?: (done: number, total: number) => void;
  }
): Promise<
  Map<
    string,
    {
      metaVariantCount: number | null;
      brandResultCount: number | null;
    }
  >
> {
  const log = options?.onLog;
  const onProgress = options?.onProgress;
  const browser = await launchChromium();
  try {
    const result = new Map<
      string,
      {
        metaVariantCount: number | null;
        brandResultCount: number | null;
      }
    >();
    let done = 0;
    for (const id of adArchiveIds) {
      const r = await fetchAdLibrarySignals(id, { browser });
      result.set(id, r);
      done += 1;
      onProgress?.(done, adArchiveIds.length);
      if (log) {
        log(
          `  [${done}/${adArchiveIds.length}] ${id} variants=${r.metaVariantCount ?? "—"} brand=${r.brandResultCount ?? "—"}`
        );
      }
    }
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function batchFetchAdvertiserPageIds(
  adArchiveIds: string[],
  options?: { concurrency?: number; onLog?: (line: string) => void }
): Promise<Map<string, string>> {
  // Playwright is heavy — keep concurrency low (3 contexts at once)
  // and reuse one browser instance across the whole batch.
  const concurrency = options?.concurrency ?? 3;
  const log = options?.onLog;
  const browser = await launchChromium();
  try {
    const result = new Map<string, string>();
    let cursor = 0;
    const worker = async () => {
      while (cursor < adArchiveIds.length) {
        const i = cursor++;
        const id = adArchiveIds[i];
        const r = await fetchAdvertiserPageId(id, { browser });
        if (r.pageId) result.set(id, r.pageId);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, adArchiveIds.length) },
        () => worker()
      )
    );
    log?.(
      `  → resolved ${result.size}/${adArchiveIds.length} advertiser page_ids`
    );
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Web equivalent of meta-scraper.ts denseCollect: terms → pageIds → merge.
 */
export async function denseCollectWeb(
  keyword: string,
  options?: {
    country?: string;
    maxScrolls?: number;
    onLog?: (line: string) => void;
  }
): Promise<{
  ads: MetaScrapedAd[];
  pages: Array<{ pageId: string; pageName: string; adsFromTerms: number }>;
  /** Long-form advertiser entity IDs surfaced by stage 1.5. Worker
   *  auto-registers any unseen ones to MetaWatch so the next cron tick
   *  picks up that entity's full ad set. */
  discoveredAdvertiserPageIds: string[];
}> {
  const log = (m: string) => options?.onLog?.(m);
  const country = options?.country ?? "KR";
  const maxScrolls = options?.maxScrolls ?? 30;

  // Stem fallback: Meta's text search doesn't match domain suffixes
  // (`brand-b.co.kr` returned 0 while `dexcanic` returned 8). When the
  // keyword looks like `<stem>.<tld>`, try the stem too and union the
  // results. Surfaces brands the user reflexively types as ".kr/.com"
  // without forcing them to pre-strip the suffix.
  const stem = keyword.replace(
    /\.(co\.kr|kr|com|net|io|shop|store)$/i,
    ""
  );
  const queriesToTry = stem !== keyword ? [keyword, stem] : [keyword];

  log(`stage 1: search_terms=[${queriesToTry.join(", ")}]`);
  const termHitMap = new Map<string, MetaScrapedAd>();
  for (const q of queriesToTry) {
    const hits = await searchByTermsWeb(q, {
      country,
      maxScrolls,
      onLog: log,
    });
    let added = 0;
    for (const ad of hits) {
      if (!termHitMap.has(ad.adArchiveId)) {
        termHitMap.set(ad.adArchiveId, ad);
        added++;
      }
    }
    log(`  "${q}" → ${hits.length} hits (+${added} new)`);
  }
  const termHits = Array.from(termHitMap.values());
  log(`  → ${termHits.length} unique ads from search_terms`);

  // Tally running pages by frequency. These are the sock-puppet /
  // operator pages that surfaced from text search.
  const byRunningPage = new Map<string, { pageName: string; count: number }>();
  for (const ad of termHits) {
    if (!ad.pageId) continue;
    const slot = byRunningPage.get(ad.pageId) ?? {
      pageName: ad.pageName,
      count: 0,
    };
    slot.count++;
    byRunningPage.set(ad.pageId, slot);
  }
  const runningPages = Array.from(byRunningPage.entries())
    .map(([pageId, v]) => ({
      pageId,
      pageName: v.pageName,
      adsFromTerms: v.count,
    }))
    .sort((a, b) => b.adsFromTerms - a.adsFromTerms);
  log(`  → ${runningPages.length} unique running pages`);

  // Stage 1.5 — for each unique running page, fetch one of its ads'
  // detail page and pull the advertiser entity page_id. Same brand
  // typically maps to 1–2 advertiser entities even when 30+ different
  // sock-puppet pages serve their ads. Knowing those entity IDs lets
  // us call search_page_ids on the advertiser side and surface ads
  // operated under sock-puppets we never would have searched for.
  //
  // Cap to top N pages by ad count. Without this, big brands (brand-a.co.kr
  // had 168 unique running pages) each trigger a separate chromium scrape
  // — ~5 MB × 168 = ~800 MB per cron run, blowing the IPRoyal monthly
  // budget in 3 days. Top 30 still covers the meaningful advertiser-
  // entity set because the long tail is sock puppets running 1–2 ads.
  const STAGE_1_5_CAP = 30;
  const topPagesForStage1_5 = new Set(
    runningPages.slice(0, STAGE_1_5_CAP).map((p) => p.pageId)
  );
  const sampleAdIds: string[] = [];
  const seenPages = new Set<string>();
  for (const ad of termHits) {
    if (!ad.pageId || seenPages.has(ad.pageId)) continue;
    if (!topPagesForStage1_5.has(ad.pageId)) continue;
    seenPages.add(ad.pageId);
    sampleAdIds.push(ad.adArchiveId);
  }
  log(
    `stage 1.5: resolving advertiser entity for ${sampleAdIds.length} pages (top ${STAGE_1_5_CAP} of ${runningPages.length})`
  );
  const adIdToAdvertiser = await batchFetchAdvertiserPageIds(sampleAdIds, {
    concurrency: 8,
    onLog: log,
  });
  const advertiserIds = new Set<string>();
  for (const id of adIdToAdvertiser.values()) advertiserIds.add(id);
  log(
    `  → ${advertiserIds.size} unique advertiser entities (vs ${runningPages.length} running pages)`
  );

  // Build the final scoop list: union of (top running pages) +
  // (advertiser entities). Advertiser entities go first because they
  // tend to surface official + sock-puppet siblings together.
  const TOP_PAGES = Math.min(8, runningPages.length);
  const scoopList: Array<{ pageId: string; label: string }> = [];
  for (const aid of advertiserIds) {
    scoopList.push({ pageId: aid, label: `advertiser:${aid}` });
  }
  for (let i = 0; i < TOP_PAGES; i++) {
    const p = runningPages[i];
    if (!advertiserIds.has(p.pageId))
      scoopList.push({
        pageId: p.pageId,
        label: `running:${p.pageName}`,
      });
  }
  log(
    `stage 2: scoop ${scoopList.length} pages (${advertiserIds.size} advertiser + ${
      scoopList.length - advertiserIds.size
    } running)`
  );

  const merged = new Map<string, MetaScrapedAd>();
  for (const a of termHits) merged.set(a.adArchiveId, a);
  for (let i = 0; i < scoopList.length; i++) {
    const p = scoopList[i];
    log(`  ${i + 1}/${scoopList.length}: ${p.label} (${p.pageId})`);
    try {
      const hits = await searchByPageIdWeb(p.pageId, {
        country,
        maxScrolls: Math.max(15, Math.floor(maxScrolls / 2)),
        onLog: log,
      });
      let added = 0;
      for (const a of hits) {
        if (!merged.has(a.adArchiveId)) {
          merged.set(a.adArchiveId, a);
          added++;
        }
      }
      log(`    +${added} new (page ${hits.length} total)`);
    } catch (e) {
      log(`    page ${p.pageId} failed: ${(e as Error).message}`);
    }
  }
  log(`stage 3: merged → ${merged.size} unique ads`);
  return {
    ads: Array.from(merged.values()),
    pages: runningPages,
    discoveredAdvertiserPageIds: Array.from(advertiserIds),
  };
}
