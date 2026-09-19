/**
 * Deep YouTube ID extractor for ATC video ads.
 *
 * The /adframe iframe is same-origin (relative URL) so we can access its
 * .frame.content() HTML directly. Inside that HTML, YouTube ad creatives
 * embed video IDs in patterns like youtube.com/watch?v=, youtu.be/,
 * i.ytimg.com/vi/, or in JSON-encoded data attributes.
 *
 * Strategy:
 *   1. Open ATC, search keyword, click first matching advertiser.
 *   2. Wait long enough for all ad iframes to load.
 *   3. For each iframe, get its content HTML (same-origin works).
 *   4. Extract YouTube IDs via regex.
 *   5. Map iframe index → creativeId (DOM order matches API order).
 *
 * Usage: npx tsx scripts/deep-yt-extract.ts <keyword>
 */
import { chromium } from "playwright";

const QUERY = process.argv[2] ?? "쿠팡";
const REGION = process.argv[3] ?? "KR";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1366, height: 1200 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // Capture YouTube IDs from network as fallback
  const networkIds = new Set<string>();
  page.on("request", (req) => {
    const url = req.url();
    const re =
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/|i\.ytimg\.com\/vi\/|googlevideo\.com\/.*?docid=)([\w-]{11})/;
    const m = url.match(re);
    if (m) networkIds.add(m[1]);
  });

  console.log(`→ navigating to ATC, query="${QUERY}"`);
  await page.goto(`https://adstransparency.google.com/?region=${REGION}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(2500);
  const input = page.locator("input").first();
  await input.click();
  await input.fill(QUERY);
  await page.waitForTimeout(2500);
  const sug = page.locator('[role="option"]').first();
  if (!(await sug.count())) {
    console.error("no suggestion found");
    process.exit(1);
  }
  await sug.click();
  console.log(`→ clicked suggestion, waiting for ads to render...`);

  // Generous wait + scroll to trigger lazy loads
  await page.waitForTimeout(8000);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(1500);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(3000);

  console.log(`→ extracting from iframes...`);
  const iframes = page.locator("iframe");
  const total = await iframes.count();
  console.log(`  ${total} iframes found`);

  const perIframeIds: Array<{ index: number; ytIds: string[]; src: string }> = [];

  for (let i = 0; i < total; i++) {
    const handle = iframes.nth(i);
    const src = (await handle.getAttribute("src").catch(() => "")) ?? "";
    let html = "";
    let frameAccessible = false;
    try {
      const frame = await handle.contentFrame();
      if (frame) {
        // Wait briefly for frame to settle
        await frame.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
        html = await frame.content().catch(() => "");
        frameAccessible = !!html;
      }
    } catch (e) {
      // ignore
    }

    if (!html) {
      // Fall back to evaluating innerHTML through the parent
      try {
        html = await handle.evaluate(
          (el) => (el as HTMLIFrameElement).contentDocument?.documentElement?.outerHTML ?? ""
        );
      } catch {
        // cross-origin: cannot access
      }
    }

    const ytIds = new Set<string>();
    if (html) {
      const patterns = [
        /youtube\.com\/(?:watch\?v=|embed\/|shorts\/)([\w-]{11})/g,
        /youtu\.be\/([\w-]{11})/g,
        /i\.ytimg\.com\/vi\/([\w-]{11})\//g,
        /data-video-id=["']([\w-]{11})["']/g,
        /videoId["':\s]+["']([\w-]{11})["']/g,
        /"video_id":\s*"([\w-]{11})"/g,
      ];
      for (const re of patterns) {
        for (const m of html.matchAll(re)) ytIds.add(m[1]);
      }
    }
    if (ytIds.size > 0 || frameAccessible) {
      perIframeIds.push({
        index: i,
        ytIds: Array.from(ytIds),
        src: src.slice(0, 60),
      });
    }
  }

  console.log(`\n=== Iframes with content ===`);
  for (const r of perIframeIds.slice(0, 30)) {
    console.log(
      `  iframe[${r.index}] src=${r.src} → ${r.ytIds.length > 0 ? r.ytIds.join(", ") : "(no yt IDs)"}`
    );
  }

  console.log(`\n=== Network-captured YouTube IDs ===`);
  console.log(`  count: ${networkIds.size}`);
  Array.from(networkIds)
    .slice(0, 30)
    .forEach((id) => console.log(`  https://youtu.be/${id}`));

  const allIds = new Set<string>(networkIds);
  perIframeIds.forEach((r) => r.ytIds.forEach((id) => allIds.add(id)));
  console.log(`\n=== TOTAL unique YouTube IDs: ${allIds.size} ===`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
