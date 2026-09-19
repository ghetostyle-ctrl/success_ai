import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const NAME_POLYFILL = `(function(){try{const d=Object.getOwnPropertyDescriptor(Function.prototype,'name');if(!d||d.configurable===false){Object.defineProperty(Function.prototype,'name',{value:'',writable:true,configurable:true});}}catch(e){}})();`;

async function probe(url: string, label: string) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: "ko-KR", viewport: { width: 1366, height: 900 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" });
  await ctx.addInitScript({ content: NAME_POLYFILL });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(5000);
  const text = await page.evaluate(() => document.body.innerText);
  console.log(`\n=== ${label} (${url}) ===`);
  console.log(`text len: ${text.length}`);
  // Search for digit patterns near reactions/likes/comments wording
  const lines = text.split("\n").filter(l => /[\d]/.test(l) && /[a-zA-Z가-힣]/.test(l));
  console.log("digit-bearing lines:");
  for (const line of lines.slice(0, 30)) console.log("  ", line.slice(0, 120));
  await browser.close();
}

async function main() {
  const id = process.argv[2] || "1377893524176676";
  // Try several URL patterns
  await probe(`https://www.facebook.com/ads/library/?id=${id}`, "library detail");
  await probe(`https://www.facebook.com/ads/library/snapshot/${id}/`, "snapshot path");
}
main().catch(e => { console.error(e); process.exit(1); });
