/**
 * ATC 사이트의 SearchCreatives RPC 호출 시 실제 보내는 HEADERS 를 dump.
 * 우리 curl 과 비교해서 누락된 header (cookie, auth token, x-client-data
 * 등) 찾기. 응답이 40개+cursor vs 2개+no cursor 의 차이는 headers 차이.
 */
import { chromium } from "playwright";

async function main() {
  const QUERY = "brand-d.co.kr";
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1366, height: 900 },
  });
  const page = await ctx.newPage();

  let captured = false;
  page.on("request", async (req) => {
    if (!req.url().includes("/rpc/SearchService/SearchCreatives")) return;
    if (captured) return;
    captured = true;
    const headers = req.headers();
    console.log("\n=== SearchCreatives REQUEST HEADERS ===");
    for (const [k, v] of Object.entries(headers).sort()) {
      // truncate cookie/long values
      const display = v.length > 200 ? v.slice(0, 200) + "..." : v;
      console.log(`  ${k}: ${display}`);
    }
    console.log(`\n=== METHOD/URL ===`);
    console.log(`  ${req.method()} ${req.url()}`);
    console.log(`\n=== POST DATA (first 500) ===`);
    console.log(`  ${(req.postData() ?? "").slice(0, 500)}`);
  });

  await page.goto(`https://adstransparency.google.com/?region=KR`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2500);
  const input = page.locator("input").first();
  await input.click();
  await input.fill(QUERY);
  await page.waitForTimeout(2500);
  const options = await page.locator('[role="option"]').all();
  if (options.length === 0) {
    console.error("no suggestions");
    await browser.close();
    return;
  }
  await options[0].click();
  await page.waitForTimeout(5000);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
