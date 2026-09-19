/**
 * Diagnose YouTube extraction: take all type-2 + type-3 ads from a domain
 * and visit each one slowly, with verbose logging.
 */
import { chromium } from "playwright";
import { scrapeAds } from "../src/lib/atc-scraper";

const QUERY = process.argv[2] ?? "example.co.kr";

async function main() {
  console.log(`Fetching all ads for ${QUERY}...`);
  const r = await scrapeAds(QUERY, { maxPages: 6 });
  console.log(`Got ${r.ads.length} total ads`);

  const types: Record<string, number> = {};
  for (const a of r.ads) types[a.type] = (types[a.type] ?? 0) + 1;
  console.log(`Types:`, types);

  const candidates = r.ads.filter(
    (a) => a.type === "video" || a.type === "other"
  );
  console.log(`Video + other candidates: ${candidates.length}`);

  // Take first 30 sorted by lastSeen desc — these are the most likely to be active
  const sorted = [...candidates].sort((a, b) => {
    const la = parseInt(a.lastSeen ?? "0", 10);
    const lb = parseInt(b.lastSeen ?? "0", 10);
    return lb - la;
  });
  const sample = sorted.slice(0, 30);
  console.log(`\nVisiting top ${sample.length} by recency...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1280, height: 800 },
  });

  const matches: { creativeId: string; type: string; ytId?: string; lastSeen?: string }[] = [];

  // CONCURRENT with SEPARATE CONTEXTS per worker
  const CONCURRENCY = 3;
  const WAIT_MS = 6000;
  let cursor = 0;
  const results: typeof matches = new Array(sample.length);
  async function worker(workerId: number) {
    // Each worker gets its own context (own cookies/session)
    const wc = await browser.newContext({
      locale: "ko-KR",
      viewport: { width: 1280, height: 800 },
    });
    while (true) {
      const i = cursor++;
      if (i >= sample.length) {
        await wc.close();
        return;
      }
      const ad = sample[i];
      const page = await wc.newPage();
      const ytIds = new Set<string>();
      page.on("request", (req) => {
        const m = req.url().match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/|i\.ytimg\.com\/vi\/)([\w-]{11})/);
        if (m) ytIds.add(m[1]);
      });
      const url = `https://adstransparency.google.com/advertiser/${ad.advertiserId}/creative/${ad.creativeId}?region=KR`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(WAIT_MS);
      } catch {}
      const yt = ytIds.size > 0 ? Array.from(ytIds)[0] : undefined;
      results[i] = { creativeId: ad.creativeId, type: ad.type, ytId: yt, lastSeen: ad.lastSeen ?? undefined };
      console.log(`  w${workerId} [${i + 1}/${sample.length}] ${ad.type.padEnd(5)} ${ad.creativeId.slice(-10)} → ${yt ?? "(none)"}`);
      await page.close();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));
  matches.push(...results);

  // unused legacy loop replacement
  if (false) for (let i = 0; i < sample.length; i++) {
    const ad = sample[i];
    const page = await context.newPage();
    const ytIds = new Set<string>();
    page.on("request", (req) => {
      const m = req.url().match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/|i\.ytimg\.com\/vi\/)([\w-]{11})/);
      if (m) ytIds.add(m[1]);
    });
    const url = `https://adstransparency.google.com/advertiser/${ad.advertiserId}/creative/${ad.creativeId}?region=KR`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(8000); // longer wait
    } catch (e) {
      console.log(`  [${i + 1}] ${ad.type} ${ad.creativeId.slice(-10)} TIMEOUT`);
    }
    const yt = ytIds.size > 0 ? Array.from(ytIds)[0] : undefined;
    matches.push({
      creativeId: ad.creativeId,
      type: ad.type,
      ytId: yt,
      lastSeen: ad.lastSeen ?? undefined,
    });
    const lastSeenDate = ad.lastSeen
      ? new Date(parseInt(ad.lastSeen, 10) * 1000).toISOString().slice(0, 10)
      : "?";
    console.log(
      `  [${i + 1}/${sample.length}] ${ad.type.padEnd(5)} ${ad.creativeId.slice(-10)} lastSeen=${lastSeenDate} → ${yt ?? "(none)"}`
    );
    await page.close();
    await new Promise((r) => setTimeout(r, 500));
  } // end legacy loop

  await browser.close();

  const matched = matches.filter((m) => m.ytId);
  const byType: Record<string, { total: number; matched: number }> = {};
  for (const m of matches) {
    byType[m.type] = byType[m.type] ?? { total: 0, matched: 0 };
    byType[m.type].total++;
    if (m.ytId) byType[m.type].matched++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`total visited: ${matches.length}, matched: ${matched.length} (${Math.round((matched.length / matches.length) * 100)}%)`);
  for (const [t, s] of Object.entries(byType)) {
    console.log(`  ${t}: ${s.matched}/${s.total}`);
  }
  console.log(`\nUnique YouTube IDs:`, [...new Set(matched.map((m) => m.ytId))]);
}

main().catch(console.error);
