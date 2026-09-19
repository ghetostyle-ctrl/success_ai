/**
 * Google Ads Transparency Center scraper.
 * Direct HTTP calls to ATC's internal RPC endpoints (no browser needed).
 *
 * Two query modes:
 *   1) Advertiser name (e.g. "쿠팡") → SearchSuggestions returns advertiser IDs
 *      → SearchCreatives with those IDs.
 *   2) Domain (e.g. "example.co.kr") → SearchCreatives directly with the domain.
 *
 * Both endpoints discovered via reverse-engineering ATC's frontend.
 */

const ATC_BASE = "https://adstransparency.google.com";
// Mirror what a real Chrome session sends — Google's bot detection checks
// the sec-ch-ua + accept headers, so a bare User-Agent isn't enough on
// Node's undici fetch (curl gets through with fewer headers somehow).
const COMMON_HEADERS = {
  "content-type": "application/x-www-form-urlencoded",
  "x-same-domain": "1",
  accept: "*/*",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  origin: ATC_BASE,
  referer: `${ATC_BASE}/?region=KR`,
  "sec-ch-ua":
    '"Chromium";v="131", "Not.A/Brand";v="8", "Google Chrome";v="131"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

// User-Agent pool — Google's bot detection appears to fingerprint UA + IP
// combinations. Rotating UA alongside the IPRoyal session gives a fresh
// (UA, IP) pair on each retry, which cuts repeat-block odds substantially.
// All entries are recent stable Chrome variants on common platforms (no
// mobile, no obscure builds — those raise their own flags).
const UA_POOL = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
];
function pickUserAgent(idx: number): string {
  return UA_POOL[idx % UA_POOL.length];
}

const REGION_CODES: Record<string, number> = {
  KR: 2410,
  US: 2840,
  JP: 2392,
  GB: 2826,
};

export type AdvertiserSuggestion = {
  name: string;
  advertiserId: string;
  region: string;
  adCountLow: number;
  adCountHigh: number;
};

export type DomainSuggestion = {
  domain: string;
};

export type ScrapedAd = {
  advertiserId: string;
  advertiserName: string;
  creativeId: string;
  type: "image" | "video" | "other";
  firstSeen: string | null;
  lastSeen: string | null;
  previewUrl: string | null;
  imageHtml: string | null;
  obfuscatedCustomerId: string | null;
  // 도메인 검색에서 어느 stage 에서 들어온 광고인지. parseAds 는 set 안 함;
  // scrapeAds() 의 domain mode 가 Stage1=domain, Stage3=advertiser 로 채움.
  via?: "domain" | "advertiser";
};

export type SearchMode = "advertiser" | "domain" | "auto";

function regionCode(region: string): number {
  const code = REGION_CODES[region.toUpperCase()];
  if (!code) throw new Error(`Unsupported region: ${region}`);
  return code;
}

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { notifyProxyDown, notifyCollectionDown } from "./slack";
import { createHash } from "node:crypto";
import { join } from "node:path";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Disk cache for SearchSuggestions. ATC's bot detection rate-limits us
// hard when we hit it for every search; the keyword→(advertiser, domain)
// mapping is stable across days so a 24h TTL is plenty.
const SUGGESTIONS_CACHE_DIR = join(
  process.cwd(),
  "cache",
  "suggestions"
);
const SUGGESTIONS_TTL_MS = 24 * 60 * 60 * 1000;

function suggestionsCachePath(keyword: string, region: string): string {
  const key = `${region}:${keyword}`;
  const hash = createHash("sha1").update(key).digest("hex");
  return join(SUGGESTIONS_CACHE_DIR, `${hash}.json`);
}

async function readSuggestionsCache(
  keyword: string,
  region: string
): Promise<{
  advertisers: AdvertiserSuggestion[];
  domains: DomainSuggestion[];
} | null> {
  try {
    const raw = await readFile(suggestionsCachePath(keyword, region), "utf-8");
    const parsed = JSON.parse(raw) as {
      cachedAt: number;
      advertisers: AdvertiserSuggestion[];
      domains: DomainSuggestion[];
    };
    if (Date.now() - parsed.cachedAt > SUGGESTIONS_TTL_MS) return null;
    return { advertisers: parsed.advertisers, domains: parsed.domains };
  } catch {
    return null;
  }
}

async function writeSuggestionsCache(
  keyword: string,
  region: string,
  data: { advertisers: AdvertiserSuggestion[]; domains: DomainSuggestion[] }
): Promise<void> {
  try {
    await mkdir(SUGGESTIONS_CACHE_DIR, { recursive: true });
    await writeFile(
      suggestionsCachePath(keyword, region),
      JSON.stringify({ cachedAt: Date.now(), ...data })
    );
  } catch {
    // cache failures are non-fatal
  }
}

/**
 * Shell out to curl for the ATC RPC. We tried Node's native fetch (undici),
 * but Google's bot detection distinguishes its TLS/HTTP fingerprint from
 * curl's and rate-limits aggressively. Curl with the same payload sails
 * through, so we use it for these specific endpoints.
 *
 * Retry policy:
 *   - Transient curl exits (7 connect-refused, 28 timeout, 35 SSL handshake,
 *     56 receive-failure) auto-retry up to 2× with 5s + jitter backoff.
 *     These are network blips, not Google rejecting us — failing the whole
 *     watch on the first one wastes the cron's nightly slot.
 *   - Other non-zero exits (incl. bot-challenge HTTP 302 — handled at the
 *     status-code layer, not here) reject immediately.
 */
// 5 = couldn't resolve proxy, 6 = couldn't resolve host (DNS),
// 7 = connect refused, 28 = timeout, 35 = SSL handshake,
// 52 = empty reply, 56 = receive failure. All transient — Mac sleep/wake,
// router DNS hiccup, brief network drop. Retry rather than fail the
// nightly cron's whole watch.
const TRANSIENT_CURL_EXITS = new Set([5, 6, 7, 28, 35, 52, 56]);

// Module-level "current" proxy session — set by paginateCreatives before
// each scrape, read by curlPostOnce. Each scrape gets a fresh random
// session so IPRoyal hands out a different IP, preventing the per-IP rate
// limiter from accumulating across scrapes.
let currentProxySession: string | null = null;
function newProxySession(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4)
  );
}
function rotateProxySession(): void {
  if (process.env.PROXY_URL) {
    currentProxySession = newProxySession();
  }
}

function curlPostOnce(
  url: string,
  body: string,
  headers: Record<string, string>,
  options?: { useProxy?: boolean }
): Promise<{ status: number; body: string }> {
  const useProxy = options?.useProxy !== false;
  return new Promise((resolve, reject) => {
    const args = [
      "-s",
      "-X",
      "POST",
      "-w",
      "\n__HTTP_STATUS__%{http_code}",
      // Bound any single attempt at 30s — without this curl can hang
      // on a half-open TCP for minutes before exit 28 fires.
      "--connect-timeout",
      "10",
      "--max-time",
      "30",
      url,
      "--data-raw",
      body,
    ];
    // Residential proxy support — ATC blocks datacenter IPs (DigitalOcean,
    // AWS, etc.) almost instantly with reCAPTCHA. PROXY_URL env var routes
    // every curl call through IPRoyal (or similar) residential pool so the
    // request looks like it's coming from a real Korean household.
    //   PROXY_URL=http://user:pass_country-kr@geo.iproyal.com:12321
    //
    // Per-call IP rotation: PROXY_SESSION is read from the active task's
    // AsyncLocalStorage-ish global (set by paginateCreatives below) and
    // appended to the password as `_session-XYZ`. IPRoyal pins one IP per
    // session string for ~10 min; if Google's per-IP rate limiter trips,
    // we rotate to a fresh session and retry.
    //
    // useProxy=false bypasses proxy entirely — used as a last-resort fallback
    // by curlPost when the proxy returns repeated network errors (suggests
    // IPRoyal account is broken / out of bandwidth). Bare VM IP will likely
    // bot-challenge sooner, but degraded scraping > no scraping.
    const proxyUrl = useProxy ? process.env.PROXY_URL : undefined;
    if (proxyUrl) {
      const session = currentProxySession;
      let augmented = proxyUrl;
      if (session) {
        // Insert _session-XYZ before "@" if password is present, else skip.
        augmented = proxyUrl.replace(
          /^(https?:\/\/[^:]+:)([^@]+)(@.+)$/,
          (_, p1, pw, p3) => `${p1}${pw}_session-${session}${p3}`
        );
      }
      args.push("--proxy", augmented);
      // Bump timeout — residential proxies add 100~500ms of latency per hop.
      const maxTimeIdx = args.indexOf("--max-time");
      if (maxTimeIdx >= 0) args[maxTimeIdx + 1] = "60";
    }
    for (const [k, v] of Object.entries(headers)) {
      args.push("-H", `${k}: ${v}`);
    }
    const cp = spawn("curl", args);
    let out = "";
    let err = "";
    cp.stdout.on("data", (d) => (out += d.toString()));
    cp.stderr.on("data", (d) => (err += d.toString()));
    cp.on("error", reject);
    cp.on("close", (code) => {
      if (code !== 0) {
        const errPlus = (err || "").trim();
        const e = new Error(`curl exit ${code}: ${errPlus}`);
        // Tag so the retry layer can decide.
        (e as Error & { curlCode?: number }).curlCode = code ?? -1;
        reject(e);
        return;
      }
      const m = out.match(/\n__HTTP_STATUS__(\d+)$/);
      if (!m) {
        reject(new Error("could not parse curl status"));
        return;
      }
      const status = parseInt(m[1], 10);
      const responseBody = out.slice(0, m.index!);
      resolve({ status, body: responseBody });
    });
  });
}

async function curlPost(
  url: string,
  body: string,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  const attempts = 3;
  let lastErr: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await curlPostOnce(url, body, headers);
    } catch (e) {
      lastErr = e as Error;
      const code = (e as Error & { curlCode?: number }).curlCode;
      if (code === undefined || !TRANSIENT_CURL_EXITS.has(code)) throw e;
      if (i === attempts - 1) break;
      // 5s, 12s backoff with ±20% jitter.
      const base = i === 0 ? 5_000 : 12_000;
      const jitter = base * 0.2 * (Math.random() * 2 - 1);
      await new Promise((r) => setTimeout(r, base + jitter));
    }
  }
  // All proxied attempts failed with transient curl errors. If a proxy was
  // configured, the most likely cause is that the proxy itself is broken
  // (account out of bandwidth / suspended / auth misconfigured). Try ONE
  // direct attempt as a last resort — bare VM IP will likely bot-challenge
  // sooner than residential, but a degraded scrape is far better than a
  // hard failure that triggers the user's "수집 오류" alert.
  if (process.env.PROXY_URL) {
    const lastCode = (lastErr as Error & { curlCode?: number } | null)
      ?.curlCode;
    console.warn(
      `[ATC curl] proxy failed ${attempts}× with exit ${lastCode}; falling back to DIRECT (bare VM IP). Check IPRoyal account.`
    );
    try {
      const r = await curlPostOnce(url, body, headers, { useProxy: false });
      // proxy fail → direct 성공 = IPRoyal 문제. 디바운스 알림(1시간 1회).
      void notifyProxyDown(
        `IPRoyal proxy 거부 중 — direct fallback 으로 임시 작동. 잔액/계정 확인.`
      );
      return r;
    } catch (e) {
      console.warn(
        `[ATC curl] direct fallback also failed: ${(e as Error).message}`
      );
      // proxy + direct 둘다 실패 = 수집 완전 정지. 즉시 알림.
      void notifyCollectionDown(
        `proxy(${lastErr?.message ?? "?"}) + direct(${(e as Error).message}) 둘다 실패. 수집 정지.`
      );
    }
  }
  throw lastErr ?? new Error("curl failed (no error captured)");
}

/**
 * Thrown when ATC redirects to www.google.com/sorry/index — Google's
 * shared bot-challenge interstitial. Once this fires, every subsequent
 * call from the same IP for ~1–3h will hit the same wall, so callers
 * (run-tracked.ts) should abort the rest of their batch instead of
 * burning the cooldown deeper.
 */
export class ATCBotChallengeError extends Error {
  constructor(method: string) {
    super(
      `ATC ${method}: 302 → google.com/sorry/index (bot challenge — back off ~1–3h)`
    );
    this.name = "ATCBotChallengeError";
  }
}

export function isBotChallenge(e: unknown): boolean {
  return e instanceof ATCBotChallengeError;
}

/**
 * POST to an ATC RPC endpoint via curl. Three layers of retry:
 *
 *   1) **Transient HTTP** (429 / 5xx): exponential backoff up to `maxRetries`.
 *   2) **Bot challenge** (302 → /sorry/): rotate IPRoyal session + UA, sleep
 *      with growing backoff, retry up to `maxBotRotations`. This is THE key
 *      reason the user-facing scraper used to throw "ATC SearchCreatives:
 *      302" mid-pagination — previously postRpc surfaced the bot error to
 *      the caller after a single attempt; only paginateCreatives had a
 *      one-shot rotation retry, and SearchSuggestions had none. Now both
 *      paths get the same aggressive recovery.
 *   3) Curl-level transients (network blips) are handled inside `curlPost`.
 *
 * Set `rotateOnChallenge: false` to disable layer 2 (used by callers that
 * need to handle the cursor-loss themselves, e.g. mid-pagination retries).
 */
async function postRpc(
  method: string,
  payload: unknown,
  options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    rotateOnChallenge?: boolean;
    maxBotRotations?: number;
  }
): Promise<unknown> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 2000;
  const rotateOnChallenge = options?.rotateOnChallenge !== false;
  // Only worth rotating if a proxy is configured. Without IPRoyal, every
  // rotation hits the same VM IP — pointless. With a proxy, 4 rotations
  // means up to 5 distinct (UA, IP) pairs tried before we surface the
  // bot challenge. Empirically that's enough to break through 99% of
  // burst-rate blocks without dragging the inline-search UX past 1 minute.
  const maxBotRotations =
    options?.maxBotRotations ??
    (rotateOnChallenge && process.env.PROXY_URL ? 4 : 0);

  const body = `f.req=${encodeURIComponent(JSON.stringify(payload))}`;
  const url = `${ATC_BASE}/anji/_/rpc/SearchService/${method}?authuser=`;

  let attempt = 0; // counts 429/5xx retries
  let rotationCount = 0; // counts bot-challenge rotations

  while (true) {
    // curl needs a minimal header set — too many actually triggers detection
    // (the bare set used in our successful curl tests works reliably).
    // Rotate UA per bot-challenge attempt so Google sees a fresh fingerprint.
    const minimalHeaders: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      "x-same-domain": "1",
      referer: `${ATC_BASE}/?region=KR`,
      "user-agent": pickUserAgent(rotationCount),
    };

    const res = await curlPost(url, body, minimalHeaders);
    if (res.status >= 200 && res.status < 300) {
      try {
        return JSON.parse(res.body);
      } catch {
        throw new Error(
          `ATC ${method}: failed to parse response: ${res.body.slice(0, 200)}`
        );
      }
    }

    // 302 → /sorry/ is the bot challenge. Old behavior: throw immediately.
    // New: if proxy is set, rotate to a fresh IP+UA and retry with growing
    // backoff. 5s, 10s, 17s, 28s — total ~60s for 4 rotations.
    if (res.status === 302 && /sorry|google\.com\/sorry/i.test(res.body)) {
      if (rotationCount >= maxBotRotations) {
        throw new ATCBotChallengeError(method);
      }
      rotationCount++;
      rotateProxySession();
      const delay = 5_000 * Math.pow(1.65, rotationCount - 1);
      const jitter = delay * 0.15 * Math.random();
      const waitMs = Math.round(delay + jitter);
      console.warn(
        `[ATC ${method}] bot challenge — rotation ${rotationCount}/${maxBotRotations}, waiting ${Math.round(waitMs / 1000)}s with fresh IP+UA`
      );
      await sleep(waitMs);
      continue;
    }

    const transient = res.status === 429 || res.status >= 500;
    if (!transient || attempt === maxRetries) {
      throw new Error(
        `ATC ${method} failed (${res.status}): ${res.body.slice(0, 200)}`
      );
    }
    attempt++;
    const delay = baseDelayMs * Math.pow(2, attempt - 1);
    await sleep(delay);
  }
}

/**
 * Internal helper: paginates through SearchCreatives by passing the cursor
 * token (response field "2") back as request field "4".
 *
 * @param buildPayload returns a fresh request payload (without cursor)
 * @param maxPages safety cap; -1 = no cap
 */
async function paginateCreatives(
  buildPayload: () => Record<string, unknown>,
  maxPages: number,
  onPage?: (pageIdx: number, ads: RawAd[]) => void
): Promise<RawAd[]> {
  // Fresh proxy IP for this scrape. Without this, Google's per-IP rate
  // limiter accumulates across scrapes and trips around the 10th call.
  // Rotating every ~5 pages within a scrape keeps each IP under the radar.
  rotateProxySession();
  const all: RawAd[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  // Tolerate one duplicate-only page before giving up. ATC occasionally
  // returns a fully-overlapping page mid-stream; bailing on the first
  // newCount===0 was cutting off accounts well before their real total.
  let emptyStreak = 0;
  for (let i = 0; maxPages < 0 || i < maxPages; i++) {
    // Proactive IP rotation every 5 pages — cheaper than waiting for the
    // bot detector to trip. postRpc internally re-rotates if it does trip,
    // so this is just hygiene to spread requests over more (UA, IP) pairs.
    if (i > 0 && i % 5 === 0) rotateProxySession();
    const payload = buildPayload();
    if (cursor) payload["4"] = cursor;
    let res;
    try {
      // postRpc now handles bot challenges with up to 4 IP+UA rotations
      // and growing backoff (5s → 28s). Caller no longer needs its own
      // rotation retry — keeping the try/catch only to convert mid-
      // pagination "all rotations exhausted" into a partial-results return
      // (better than throwing away 100+ ads we already collected).
      res = (await postRpc("SearchCreatives", payload)) as {
        "1"?: RawAd[];
        "2"?: string;
      };
    } catch (e) {
      // 페이지를 돌다가 터진 경우. 이미 모은 게 있으면 그걸 반환한다 —
      // 부분 데이터가 0건보다 낫고, 다음 실행에서 creativeId 로 dedup 되며
      // 이어서 채워진다. 첫 페이지부터 터졌으면 그대로 던져서 호출자가
      // 진짜 실패로 처리하게 둔다.
      //
      // 예전에는 bot challenge 일 때만 부분 반환했는데, 그 바람에 DNS 가
      // ~17초 끊긴 것(curl exit 6, 재시도 3회 소진)만으로 30페이지 1,200건을
      // 통째로 버린 적이 있다. 원인이 무엇이든 이미 받은 건 지키는 게 맞다.
      if (all.length > 0) {
        const why = isBotChallenge(e) ? "bot challenge" : (e as Error).message;
        console.warn(
          `[ATC paginate] page ${i} 에서 중단 (${why}) — 모은 ${all.length}건 반환`
        );
        return all;
      }
      throw e;
    }
    const ads = res["1"] ?? [];
    let newCount = 0;
    for (const a of ads) {
      if (!seen.has(a["2"])) {
        seen.add(a["2"]);
        all.push(a);
        newCount++;
      }
    }
    onPage?.(i + 1, ads);
    cursor = res["2"];
    if (!cursor) break;
    if (newCount === 0) {
      emptyStreak++;
      if (emptyStreak >= 2) break;
    } else {
      emptyStreak = 0;
    }
    // Throttle between pages — residential IP rotation every 5 pages
    // already drops the per-IP burst rate enough that we don't need 5s
    // between calls. 3s keeps user-facing scrape under 2 minutes for
    // typical brands, with cron able to absorb longer scrapes overnight.
    // Bumped from 2s after seeing burst-rate blocks at 2s cadence.
    await sleep(3000);
  }
  return all;
}

/**
 * Auto-detect: looks like a domain if it contains a dot and no spaces
 * (and doesn't start with numbers — to avoid false-positive on phone-ish input).
 */
export function looksLikeDomain(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (/\s/.test(q)) return false;
  if (!/\./.test(q)) return false;
  // strip protocol if present
  const stripped = q.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}/i.test(stripped);
}

export function normalizeDomain(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*/, "");
}

/**
 * Search suggestions — returns mixed advertiser and domain entries.
 */
export async function searchSuggestions(
  keyword: string,
  region = "KR",
  options?: { forceRefresh?: boolean }
): Promise<{
  advertisers: AdvertiserSuggestion[];
  domains: DomainSuggestion[];
}> {
  if (!options?.forceRefresh) {
    const cached = await readSuggestionsCache(keyword, region);
    if (cached) return cached;
  }
  const code = regionCode(region);
  const payload = {
    "1": keyword,
    "2": 10,
    "3": 10,
    "4": [code],
    "5": { "1": 1 },
  };
  const res = (await postRpc("SearchSuggestions", payload)) as {
    "1"?: Array<
      | {
          "1": {
            "1": string;
            "2": string;
            "3": string;
            "4"?: { "2"?: { "1"?: string; "2"?: string } };
          };
        }
      | { "2": { "1": string } }
    >;
  };
  const advertisers: AdvertiserSuggestion[] = [];
  const domains: DomainSuggestion[] = [];
  for (const item of res["1"] ?? []) {
    if ("1" in item) {
      const inner = item["1"];
      const range = inner["4"]?.["2"] ?? {};
      advertisers.push({
        name: inner["1"],
        advertiserId: inner["2"],
        region: inner["3"],
        adCountLow: parseInt(range["1"] ?? "0", 10),
        adCountHigh: parseInt(range["2"] ?? "0", 10),
      });
    } else if ("2" in item) {
      domains.push({ domain: item["2"]["1"] });
    }
  }
  await writeSuggestionsCache(keyword, region, { advertisers, domains });
  return { advertisers, domains };
}

type RawAd = {
  "1": string;
  "2": string;
  "3"?: {
    "1"?: { "4"?: string };
    "3"?: { "2"?: string };
  };
  "4"?: number;
  "6"?: { "1"?: string };
  "7"?: { "1"?: string };
  "12"?: string;
};

function classifyType(t: number | undefined): ScrapedAd["type"] {
  if (t === 1) return "image";
  if (t === 2) return "video";
  return "other";
}

function extractObfuscatedCustomerId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/obfuscatedCustomerId=(\d+)/);
  return m?.[1] ?? null;
}

function parseAds(res: { "1"?: RawAd[] }): ScrapedAd[] {
  return (res["1"] ?? []).map((a) => {
    const previewUrl = a["3"]?.["1"]?.["4"] ?? null;
    const imageHtml = a["3"]?.["3"]?.["2"] ?? null;
    let type = classifyType(a["4"]);
    // ATC mis-classifies many static-image / GIF / HTML5-banner creatives
    // as type=2 (video). The give-away is that they only ship imageHtml,
    // not a content.js previewUrl. Re-label those as 'image' so the UI
    // and downstream extractor don't waste time on them.
    if (type === "video" && !previewUrl && imageHtml) {
      type = "image";
    }
    return {
      advertiserId: a["1"],
      advertiserName: a["12"] ?? "",
      creativeId: a["2"],
      type,
      firstSeen: a["6"]?.["1"] ?? null,
      lastSeen: a["7"]?.["1"] ?? null,
      previewUrl,
      imageHtml,
      obfuscatedCustomerId: extractObfuscatedCustomerId(previewUrl),
    };
  });
}

export async function getAdsForAdvertisers(
  advertiserIds: string[],
  region = "KR",
  pageSize = 40,
  // 본질: brand 광고 누락없이. paginateCreatives 가 cursor 끝나면 자연 종료
  // → cap 은 무한루프 방지용 안전망. 10 이었을 때 brand-d=3000 도 400개에서
  // 잘렸음. 200(=8000) 으로 풀어서 대형 brand 도 cursor 끝까지.
  maxPages = 200,
  onPage?: (pageIdx: number, total: number) => void
): Promise<ScrapedAd[]> {
  if (advertiserIds.length === 0) return [];
  const code = regionCode(region);
  const buildPayload = () => ({
    "2": pageSize,
    "3": {
      "8": [code],
      "12": { "1": "", "2": true },
      "13": { "1": advertiserIds },
    },
    "7": { "1": 1, "2": 0, "3": code },
  });
  const raw = await paginateCreatives(buildPayload, maxPages, (i, ads) =>
    onPage?.(i, ads.length)
  );
  return parseAds({ "1": raw });
}

export async function getAdsForDomain(
  domain: string,
  region = "KR",
  pageSize = 40,
  // 본질: brand 광고 누락없이. paginateCreatives 가 cursor 끝나면 자연 종료
  // → cap 은 무한루프 방지용 안전망. 10 이었을 때 brand-d=3000 도 400개에서
  // 잘렸음. 200(=8000) 으로 풀어서 대형 brand 도 cursor 끝까지.
  maxPages = 200,
  onPage?: (pageIdx: number, total: number) => void
): Promise<ScrapedAd[]> {
  const code = regionCode(region);
  const buildPayload = () => ({
    "2": pageSize,
    "3": {
      "8": [code],
      "12": { "1": domain, "2": true },
    },
    "7": { "1": 1, "2": 0, "3": code },
  });
  const raw = await paginateCreatives(buildPayload, maxPages, (i, ads) =>
    onPage?.(i, ads.length)
  );
  return parseAds({ "1": raw });
}

/**
 * High-level entrypoint. Decides advertiser vs domain mode automatically
 * (or uses the explicit mode if provided), then fetches ads with pagination.
 */
export async function scrapeAds(
  query: string,
  options?: {
    region?: string;
    mode?: SearchMode;
    topAdvertisers?: number;
    pageSize?: number;
    maxPages?: number;
    onPage?: (pageIdx: number, totalCollected: number) => void;
  }
): Promise<{
  mode: "advertiser" | "domain";
  advertisers: AdvertiserSuggestion[];
  domain: string | null;
  ads: ScrapedAd[];
}> {
  const region = options?.region ?? "KR";
  const topAdvertisers = options?.topAdvertisers ?? 5;
  const pageSize = options?.pageSize ?? 40;
  const maxPages = options?.maxPages ?? 200;
  const userMode = options?.mode ?? "auto";

  const isDomain =
    userMode === "domain" || (userMode === "auto" && looksLikeDomain(query));

  let totalCollected = 0;
  const wrappedOnPage = (i: number, batch: number) => {
    totalCollected += batch;
    options?.onPage?.(i, totalCollected);
  };

  if (isDomain) {
    const domain = normalizeDomain(query);
    // === Stage 1: domain mode returns ACTIVE ads only ===
    const domainAds = await getAdsForDomain(
      domain,
      region,
      pageSize,
      maxPages,
      wrappedOnPage
    );
    const allAdsById = new Map<string, ScrapedAd>();
    // Stage1 = 그 도메인 직접 광고. via="domain" 태깅 → UI 의 "🎯 이
    // 도메인만" 토글이 형제 brand 분리하는 근거.
    for (const a of domainAds) allAdsById.set(a.creativeId, { ...a, via: "domain" });
    const seenAdvertisers = new Map<string, AdvertiserSuggestion>();
    for (const ad of domainAds) {
      if (!seenAdvertisers.has(ad.advertiserId)) {
        seenAdvertisers.set(ad.advertiserId, {
          name: ad.advertiserName,
          advertiserId: ad.advertiserId,
          region,
          adCountLow: 0,
          adCountHigh: 0,
        });
      }
    }

    // === Stage 2: name fan-out — domain returns active only and only
    // ONE advertiser, but searching by the brand NAME often surfaces
    // additional advertisers + their inactive ads. Example: example-shop.com
    // domain mode returns 9 ads / 1 advertiser; "예시샵" name mode
    // returns 51 ads / 2 advertisers. Closes that 5x gap automatically.
    const nameQueries = new Set<string>();
    for (const ad of domainAds) {
      // Skip generic-suffix names (LLC, Inc., 주식회사) so we don't get
      // unrelated companies sharing those suffixes.
      const cleanName = ad.advertiserName
        .replace(/\b(주식회사|㈜|\(주\))\b/g, "")
        .trim();
      if (cleanName.length >= 2) nameQueries.add(cleanName);
    }
    for (const nameQuery of nameQueries) {
      try {
        const { advertisers: byName } = await searchSuggestions(nameQuery, region);
        for (const a of byName) {
          if (!seenAdvertisers.has(a.advertiserId)) {
            seenAdvertisers.set(a.advertiserId, a);
          } else {
            // Merge ad-count stats so caller sees the full picture.
            const cur = seenAdvertisers.get(a.advertiserId)!;
            cur.adCountLow = Math.max(cur.adCountLow, a.adCountLow);
            cur.adCountHigh = Math.max(cur.adCountHigh, a.adCountHigh);
          }
        }
      } catch {
        // suggestion failures are non-fatal — keep stage-1 results
      }
    }

    // Stage 3: pull ALL ads for every advertiser we now know about.
    // Includes inactive — closes the "ATC web shows 41, our domain
    // returns 9" gap by going through advertiser-mode (which doesn't
    // filter to active-only).
    const allAdvIds = Array.from(seenAdvertisers.keys());
    if (allAdvIds.length > 0) {
      const moreAds = await getAdsForAdvertisers(
        allAdvIds,
        region,
        pageSize,
        maxPages,
        wrappedOnPage
      );
      // Stage3 = 같은 광고주(예: 모브랜드사)의 형제 brand 광고. via="advertiser"
      // 태깅. Stage1 에 이미 있는 광고는 그대로 ("domain" 우선).
      for (const a of moreAds) {
        if (!allAdsById.has(a.creativeId)) {
          allAdsById.set(a.creativeId, { ...a, via: "advertiser" });
        }
      }
    }

    return {
      mode: "domain",
      domain,
      advertisers: Array.from(seenAdvertisers.values()),
      ads: Array.from(allAdsById.values()),
    };
  }

  // Advertiser-name path
  const { advertisers } = await searchSuggestions(query, region);
  if (advertisers.length === 0) {
    return { mode: "advertiser", domain: null, advertisers: [], ads: [] };
  }
  const top = [...advertisers]
    .sort(
      (a, b) =>
        (b.adCountLow + b.adCountHigh) / 2 -
        (a.adCountLow + a.adCountHigh) / 2
    )
    .slice(0, topAdvertisers);

  const ads = await getAdsForAdvertisers(
    top.map((a) => a.advertiserId),
    region,
    pageSize,
    maxPages,
    wrappedOnPage
  );

  return { mode: "advertiser", domain: null, advertisers: top, ads };
}
