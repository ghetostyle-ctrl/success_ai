import { chromium } from "playwright";
async function main() {
  const url = "https://adstransparency.google.com/?region=KR&domain=example-shop.com";
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: "ko-KR", viewport: { width: 1366, height: 1200 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(6000);
  // Scroll for lazy load
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
  }
  // Pull all advertiser IDs and creative IDs from links
  const result = await page.evaluate(() => {
    const advs = new Set<string>();
    const creatives = new Set<string>();
    document.querySelectorAll('a[href*="/advertiser/"]').forEach((el) => {
      const href = el.getAttribute("href") ?? "";
      const adv = href.match(/\/advertiser\/(AR[A-Z0-9]+)/);
      if (adv) advs.add(adv[1]);
      const cr = href.match(/\/creative\/(CR[A-Z0-9]+)/);
      if (cr) creatives.add(cr[1]);
    });
    const text = document.body.innerText;
    const totalMatch = text.match(/광고\s*(\d+)\s*개/);
    return {
      advertisers: Array.from(advs),
      creatives: Array.from(creatives),
      total: totalMatch ? totalMatch[1] : null,
    };
  });
  console.log(`Total ads (ATC says): ${result.total}`);
  console.log(`Advertisers found: ${result.advertisers.length}`);
  result.advertisers.forEach(id => console.log(`  ${id}`));
  console.log(`Creatives directly visible: ${result.creatives.length}`);
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
