/**
 * Capture ATC pagination request format by scrolling for more results.
 */
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  let reqIdx = 0;
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/rpc/SearchService/SearchCreatives")) {
      const data = req.postData();
      if (data) {
        const decoded = decodeURIComponent(data.replace(/^f\.req=/, ""));
        console.log(`\n[req #${++reqIdx}]`);
        console.log(decoded);
      }
    }
  });

  await page.goto("https://adstransparency.google.com/?region=KR", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2500);

  const input = page.locator("input").first();
  await input.click();
  await input.fill("example.co.kr");
  await page.waitForTimeout(2500);
  await page.locator('[role="option"]').first().click();
  await page.waitForTimeout(5000);

  // Scroll repeatedly to trigger pagination
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight)
    );
    await page.waitForTimeout(2500);
  }

  await browser.close();
}
main().catch(console.error);
