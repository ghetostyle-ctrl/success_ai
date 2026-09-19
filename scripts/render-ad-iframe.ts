/**
 * Try to render the actual ad iframe and pull a YouTube ID out.
 * The content.js URL needs to be loaded inside a browser context
 * because Google checks the htmlParentId against an actual DOM element.
 *
 * Strategy: load ATC, click on the first VIDEO ad to open the detail panel,
 * then extract YouTube URLs from the rendered iframe.
 */
import { chromium } from "playwright";

const QUERY = process.argv[2] ?? "쿠팡";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  // Capture all network requests so we can find YouTube watch URLs
  const ytIds = new Set<string>();
  page.on("request", (req) => {
    const url = req.url();
    const m =
      url.match(/youtube\.com\/(?:watch\?v=|embed\/|shorts\/)([\w-]{11})/) ||
      url.match(/youtu\.be\/([\w-]{11})/) ||
      url.match(/i\.ytimg\.com\/vi\/([\w-]{11})\//) ||
      url.match(/googlevideo\.com\/.*?docid=([\w-]{11})/);
    if (m) ytIds.add(m[1]);
  });

  console.log(`→ navigating with query=${QUERY}`);
  await page.goto(`https://adstransparency.google.com/?region=KR`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2500);

  const input = page.locator("input").first();
  await input.click();
  await input.fill(QUERY);
  await page.waitForTimeout(2500);

  await page.locator('[role="option"]').first().click();
  await page.waitForTimeout(6000);
  console.log(`✓ on results page: ${page.url()}`);

  // The ATC ad grid uses a custom container — let's wait for ad cards
  // and click them one at a time. We'll look for elements that hold the iframe.
  // Iframes initially live as /adframe placeholders that load the creative.
  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(2000);

  const iframes = await page.locator("iframe").all();
  console.log(`✓ ${iframes.length} iframes on page`);

  // Wait a bit more for iframes to load creative content
  console.log(`→ waiting for iframes to settle (10s)...`);
  await page.waitForTimeout(10000);

  // Inspect each iframe's content to find YouTube IDs
  let inspected = 0;
  for (const f of iframes) {
    if (inspected >= 15) break;
    try {
      const frame = await f.contentFrame();
      if (!frame) continue;
      const html = await frame.content().catch(() => "");
      if (!html) continue;
      const matches = [
        ...html.matchAll(/youtube\.com\/(?:watch\?v=|embed\/|shorts\/)([\w-]{11})/g),
        ...html.matchAll(/youtu\.be\/([\w-]{11})/g),
        ...html.matchAll(/i\.ytimg\.com\/vi\/([\w-]{11})\//g),
        ...html.matchAll(/data-video-id=["']([\w-]{11})["']/g),
        ...html.matchAll(/videoId["':\s]+["']([\w-]{11})["']/g),
      ];
      for (const m of matches) ytIds.add(m[1]);
      inspected++;
    } catch (e) {
      // cross-origin frame, ignore
    }
  }
  console.log(`✓ inspected ${inspected} iframe contents`);

  console.log(`\n=== YouTube IDs found across page + iframes + network ===`);
  console.log(`total unique: ${ytIds.size}`);
  Array.from(ytIds).forEach((id) => console.log(`  https://youtu.be/${id}`));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
