import { chromium } from "playwright";

const NAME_POLYFILL = `(function(){try{const d=Object.getOwnPropertyDescriptor(Function.prototype,'name');if(!d||d.configurable===false){Object.defineProperty(Function.prototype,'name',{value:'',writable:true,configurable:true});}}catch(e){}})();`;

async function main() {
  const url = "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=KR&is_targeted_country=false&media_type=all&q=example-shop.com&search_type=keyword_unordered&sort_data[direction]=desc&sort_data[mode]=total_impressions";
  console.log("URL:", url);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1366, height: 1200 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  await ctx.addInitScript({ content: NAME_POLYFILL });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(8000);

  // Scroll to load
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
  }

  const text = await page.evaluate(() => document.body.innerText);
  console.log("=== body text (first 2000 chars) ===");
  console.log(text.slice(0, 2000));
  
  // Count library IDs
  const html = await page.content();
  const ids = new Set<string>();
  for (const m of html.matchAll(/"adArchiveID":"(\d+)"/g)) ids.add(m[1]);
  for (const m of html.matchAll(/library\/\?id=(\d+)/g)) ids.add(m[1]);
  console.log(`\n=== unique adArchiveIDs found in HTML: ${ids.size} ===`);
  if (ids.size > 0) [...ids].slice(0, 10).forEach(id => console.log(`  ${id}`));
  
  // Also probe what the "결과 N개" shows
  const resultCount = text.match(/결과\s*[~약]?\s*(\d{1,5})\s*개/);
  console.log(`\n결과 카운트: ${resultCount ? resultCount[1] : "(없음)"}`);
  
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
