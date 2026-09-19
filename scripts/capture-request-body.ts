/**
 * Capture the exact request bodies sent by the ATC frontend.
 */
import { chromium } from "playwright";

const QUERY = process.argv[2] ?? "쿠팡";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  page.on("request", async (req) => {
    const url = req.url();
    if (url.includes("/rpc/SearchService/")) {
      const m = url.match(/\/rpc\/SearchService\/(\w+)/);
      const data = req.postData();
      const headers = req.headers();
      console.log(`\n=== ${m?.[1]} ===`);
      console.log(`URL: ${url}`);
      console.log(`Method: ${req.method()}`);
      console.log(`Body: ${data?.slice(0, 500)}`);
      console.log(`Headers:`);
      for (const [k, v] of Object.entries(headers)) {
        if (k === "user-agent" || k === "cookie") continue;
        console.log(`  ${k}: ${v.slice(0, 120)}`);
      }
    }
  });

  await page.goto(`https://adstransparency.google.com/?region=KR`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2500);
  const input = page.locator("input").first();
  await input.click();
  await input.fill(QUERY);
  await page.waitForTimeout(2500);
  await page.locator('[role="option"]').first().click();
  await page.waitForTimeout(5000);

  await browser.close();
}

main().catch(console.error);
