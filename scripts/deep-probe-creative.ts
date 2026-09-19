import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

async function main() {
  const url = "https://adstransparency.google.com/advertiser/AR00888607439094546433/creative/CR00850662605625229313?region=KR";
  console.log(`URL: ${url}`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1366, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  
  // Capture network requests
  const xhrs: { url: string; status: number; bodySize: number }[] = [];
  page.on("response", async (resp) => {
    const u = resp.url();
    if (u.includes("/v1/") || u.includes("rpc") || u.includes("creative")) {
      try {
        const body = await resp.text();
        xhrs.push({ url: u.slice(0, 120), status: resp.status(), bodySize: body.length });
      } catch {}
    }
  });
  
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(8000);
  
  const text = await page.evaluate(() => document.body.innerText);
  const html = await page.content();
  await writeFile("/tmp/creative-deep.html", html);
  
  console.log(`\n=== body text (full) ===`);
  console.log(text);
  console.log(`\n=== HTML size: ${(html.length/1024).toFixed(1)}KB ===`);
  console.log(`\n=== captured XHR/fetch (filtered) ===`);
  xhrs.forEach(x => console.log(`  [${x.status}] ${x.bodySize}b  ${x.url}`));
  
  // Look for the creativeId in any page data
  const cId = "CR00850662605625229313";
  const occurrences = (html.match(new RegExp(cId, "g")) || []).length;
  console.log(`\n=== "${cId}" occurrences in HTML: ${occurrences} ===`);
  if (occurrences > 0) {
    const idx = html.indexOf(cId);
    console.log(`Context around first occurrence:`);
    console.log(html.slice(Math.max(0, idx-200), idx+300));
  }
  
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
