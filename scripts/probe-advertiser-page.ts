import { chromium } from "playwright";

async function main() {
  const url = "https://adstransparency.google.com/advertiser/AR00888607439094546433?region=KR";
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: "ko-KR", viewport: { width: 1366, height: 1200 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(6000);
  
  // Scroll multiple times to trigger lazy load
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
  }
  
  const text = await page.evaluate(() => document.body.innerText);
  console.log("=== body text (first 3000 chars) ===");
  console.log(text.slice(0, 3000));
  
  // Count creative anchors
  const ids: string[] = await page.evaluate(() => {
    const set = new Set<string>();
    document.querySelectorAll('a[href*="/creative/"]').forEach((el) => {
      const m = el.getAttribute("href")?.match(/\/creative\/(CR\w+)/);
      if (m) set.add(m[1]);
    });
    return Array.from(set);
  });
  console.log(`\n=== unique creative IDs visible on page: ${ids.length} ===`);
  ids.forEach(id => console.log(`  ${id}`));
  
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
