import { chromium } from "playwright";
const ADV = "AR00888607439094546433";
const CR = "CR00850662605625229313";

async function tryRegion(region: string): Promise<string> {
  const url = `https://adstransparency.google.com/advertiser/${ADV}/creative/${CR}?region=${region}`;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: "ko-KR", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(4000);
    const text = await page.evaluate(() => document.body.innerText);
    const found = !text.includes("광고를 찾을 수 없음") && !text.includes("not be found");
    return `${region}: ${found ? "✅ FOUND" : "❌ not found"}  (${text.length}b)`;
  } finally {
    await browser.close();
  }
}
async function main() {
  for (const r of ["KR","US","JP","anywhere"]) {
    console.log(await tryRegion(r));
  }
}
main();
