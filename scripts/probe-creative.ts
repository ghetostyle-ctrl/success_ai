import { chromium } from "playwright";

async function main() {
  const url = "https://adstransparency.google.com/advertiser/AR00888607439094546433/creative/CR00850662605625229313?region=KR";
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: "ko-KR", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(5000);
  const text = await page.evaluate(() => document.body.innerText);
  console.log("=== body text (first 2000 chars) ===");
  console.log(text.slice(0, 2000));
  console.log("\n=== status keywords ===");
  for (const kw of ["게재", "게재 안", "Active", "Inactive", "차단", "정책", "Policy", "업로드", "First shown", "Last shown"]) {
    if (text.includes(kw)) console.log(`  found: "${kw}"`);
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
