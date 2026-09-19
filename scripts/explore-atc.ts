/**
 * Exploration script for Google Ads Transparency Center.
 * Run: npx tsx scripts/explore-atc.ts <advertiser-query>
 *
 * Goal: figure out how the page works, what URLs we can extract,
 * and what the DOM looks like so we can build a real scraper.
 */
import { chromium } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";

const QUERY = process.argv[2] ?? "쿠팡";
const REGION = process.argv[3] ?? "KR";

async function main() {
  console.log(`\n=== ATC exploration for "${QUERY}" in region ${REGION} ===\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // Capture all network requests for inspection
  const requests: { url: string; method: string }[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (
      url.includes("adstransparency.google.com") ||
      url.includes("googleusercontent") ||
      url.includes("youtube.com") ||
      url.includes("googlevideo")
    ) {
      requests.push({ url, method: req.method() });
    }
  });

  // 1. Go to ATC home
  console.log("→ navigating to https://adstransparency.google.com/");
  await page.goto(`https://adstransparency.google.com/?region=${REGION}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // 2. Take initial screenshot for debugging
  const outDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, "atc-home.png"), fullPage: true });
  console.log(`✓ saved home screenshot: tmp/atc-home.png`);

  // 3. Try to find the search input
  console.log("\n→ inspecting search input candidates...");
  const inputs = await page.locator("input").all();
  console.log(`  found ${inputs.length} input elements`);
  for (let i = 0; i < Math.min(inputs.length, 5); i++) {
    const placeholder = await inputs[i].getAttribute("placeholder").catch(() => null);
    const ariaLabel = await inputs[i].getAttribute("aria-label").catch(() => null);
    const role = await inputs[i].getAttribute("role").catch(() => null);
    console.log(`  [${i}] placeholder="${placeholder}" aria-label="${ariaLabel}" role="${role}"`);
  }

  // 4. Type into the first visible search input
  console.log(`\n→ typing "${QUERY}" into first input...`);
  const searchInput = page.locator("input").first();
  await searchInput.click();
  await searchInput.fill(QUERY);
  await page.waitForTimeout(2500); // wait for autocomplete

  await page.screenshot({ path: path.join(outDir, "atc-typed.png"), fullPage: true });
  console.log(`✓ saved typed screenshot: tmp/atc-typed.png`);

  // 5. Inspect autocomplete suggestions
  console.log("\n→ looking for autocomplete suggestions (role=option / li / [role=listbox])...");
  const suggestions = await page
    .locator('[role="option"], [role="listbox"] li, [role="menu"] li')
    .all();
  console.log(`  found ${suggestions.length} suggestion candidates`);
  for (let i = 0; i < Math.min(suggestions.length, 8); i++) {
    const text = await suggestions[i].textContent().catch(() => null);
    console.log(`  [${i}] ${text?.trim().slice(0, 100)}`);
  }

  // 6. Try pressing Enter and see what happens
  console.log("\n→ pressing Enter and waiting for navigation...");
  await searchInput.press("Enter");
  await page.waitForTimeout(4000);

  await page.screenshot({
    path: path.join(outDir, "atc-after-enter.png"),
    fullPage: true,
  });
  console.log(`✓ saved post-enter screenshot: tmp/atc-after-enter.png`);
  console.log(`  current URL: ${page.url()}`);

  // 7. Click first suggestion if it exists, then look for ads
  if (suggestions.length > 0) {
    console.log("\n→ alternative: clicking first suggestion instead...");
    await page.goto(`https://adstransparency.google.com/?region=${REGION}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2000);
    const input2 = page.locator("input").first();
    await input2.click();
    await input2.fill(QUERY);
    await page.waitForTimeout(2000);
    const sug = page.locator('[role="option"]').first();
    if (await sug.count()) {
      await sug.click();
      await page.waitForTimeout(4000);
      console.log(`  after suggestion-click URL: ${page.url()}`);
      await page.screenshot({
        path: path.join(outDir, "atc-suggestion-clicked.png"),
        fullPage: true,
      });
    }
  }

  // 8. Look for ad creatives on the page
  console.log("\n→ inspecting page for ads / iframes / YouTube video IDs...");
  const html = await page.content();
  const ytMatches = Array.from(
    new Set(
      [
        ...html.matchAll(/youtube\.com\/(?:watch\?v=|embed\/|shorts\/)([\w-]{11})/g),
        ...html.matchAll(/youtu\.be\/([\w-]{11})/g),
        ...html.matchAll(/i\.ytimg\.com\/vi\/([\w-]{11})\//g),
        ...html.matchAll(/data-video-id="([\w-]{11})"/g),
      ].map((m) => m[1])
    )
  );
  console.log(`  YouTube IDs found in HTML: ${ytMatches.length}`);
  ytMatches.slice(0, 10).forEach((id) => console.log(`    https://youtu.be/${id}`));

  const iframes = await page.locator("iframe").all();
  console.log(`  iframes on page: ${iframes.length}`);
  for (let i = 0; i < Math.min(iframes.length, 5); i++) {
    const src = await iframes[i].getAttribute("src").catch(() => null);
    console.log(`    [${i}] ${src?.slice(0, 120)}`);
  }

  // 9. Dump trapped network requests
  console.log(`\n→ network requests captured: ${requests.length}`);
  const interesting = requests
    .filter((r) => /SearchService|GetCreatives|SearchAd|AdsPolitical|youtube|googleusercontent/i.test(r.url))
    .slice(0, 20);
  console.log(`  interesting (${interesting.length}):`);
  interesting.forEach((r) => console.log(`    ${r.method} ${r.url.slice(0, 200)}`));

  await browser.close();
  console.log("\n✓ done. Inspect tmp/*.png and the output above.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
