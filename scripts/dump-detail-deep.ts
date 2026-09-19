/**
 * Deep dive into Meta Ad Library detail page via Playwright.
 *
 * For 3 dexcanic ads (different running pages) we want to know:
 *   1. What unique page_id values appear in the detail HTML?
 *   2. Which of those match the user-discovered advertiser pages?
 *   3. Is there a single "advertiser entity" page_id that's stable
 *      across all running pages of the same brand?
 *
 * This is the diagnostic that drives the M-9 Playwright rewrite.
 */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

async function main() {
  const adIds = process.argv.slice(2);
  if (adIds.length === 0) {
    console.error("Usage: npx tsx scripts/dump-detail-deep.ts <adId> [<adId>...]");
    process.exit(1);
  }
  const browser = await chromium.launch({ headless: true });
  for (const adId of adIds) {
    const url = `https://www.facebook.com/ads/library/?id=${adId}`;
    const ctx = await browser.newContext({
      locale: "ko-KR",
      viewport: { width: 1366, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const page = await ctx.newPage();
    console.log(`\n=== ad ${adId} ===`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);

    const html = await page.content();
    await writeFile(`/tmp/detail-${adId}.html`, html);
    console.log(`html size: ${(html.length / 1024).toFixed(0)}KB`);

    // Pull every "page_id":"<digits>" occurrence + count
    const pageIdCounts = new Map<string, number>();
    for (const m of html.matchAll(/"page_id"\s*:\s*"(\d+)"/g)) {
      const id = m[1];
      pageIdCounts.set(id, (pageIdCounts.get(id) ?? 0) + 1);
    }
    const sorted = Array.from(pageIdCounts.entries()).sort(
      (a, b) => b[1] - a[1]
    );
    console.log(`page_id occurrences (top 10):`);
    for (const [id, n] of sorted.slice(0, 10)) {
      console.log(`  ${id}  ×${n}`);
    }

    // Pull deeplink_ad_archive JSON object specifically.
    const dla = html.match(
      /"deeplink_ad_archive"\s*:\s*(\{[^]*?\}\s*,\s*"[a-z_]+"\s*:)/i
    );
    if (dla) {
      console.log(`\ndeeplink_ad_archive (first 600 chars):`);
      console.log("  " + dla[1].slice(0, 600).replace(/\n/g, "\\n"));
    } else {
      console.log("\n(no deeplink_ad_archive block found)");
    }

    // Branded content page id
    const bc = html.match(
      /"branded_content"\s*:\s*\{[^{}]*"page_id"\s*:\s*"(\d+)"/
    );
    console.log(`branded_content.page_id: ${bc ? bc[1] : "(none)"}`);

    await ctx.close();
  }
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
