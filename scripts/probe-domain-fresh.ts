import { chromium } from "playwright";
async function main() {
  const url = "https://adstransparency.google.com/?region=KR&domain=example-shop.com";
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: "ko-KR", viewport: { width: 1920, height: 1400 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(8000);
  // aggressive scroll
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(1500);
  }
  const text = await page.evaluate(() => document.body.innerText);
  // Match all "광고 N개" or "Total" patterns
  const counts = [...text.matchAll(/광고\s*(\d+)\s*개/g)].map(m => m[1]);
  const adIds = await page.evaluate(() => {
    const set = new Set<string>();
    document.querySelectorAll('a[href*="/creative/"]').forEach(el => {
      const m = el.getAttribute("href")?.match(/\/creative\/(CR[A-Z0-9]+)/);
      if (m) set.add(m[1]);
    });
    return Array.from(set);
  });
  const advIds = await page.evaluate(() => {
    const set = new Set<string>();
    document.querySelectorAll('a[href*="/advertiser/"]').forEach(el => {
      const m = el.getAttribute("href")?.match(/\/advertiser\/(AR[A-Z0-9]+)/);
      if (m) set.add(m[1]);
    });
    return Array.from(set);
  });
  console.log(`"광고 N개" patterns: [${counts.join(", ")}]`);
  console.log(`Unique advertiser IDs visible: ${advIds.length}`);
  advIds.forEach(id => console.log(`  ${id}`));
  console.log(`Unique creative IDs visible: ${adIds.length}`);
  console.log(`First 10:`); adIds.slice(0, 10).forEach(id => console.log(`  ${id}`));
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
