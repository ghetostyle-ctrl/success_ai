/**
 * Capture what happens when you click a *domain* suggestion in ATC.
 * The request body for SearchCreatives is different from advertiser search.
 */
import { chromium } from "playwright";

const QUERY = process.argv[2] ?? "example.co.kr";

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
      if (data) {
        const decoded = decodeURIComponent(data.replace(/^f\.req=/, ""));
        console.log(`\n[${m?.[1]}] body:`);
        console.log(`  ${decoded.slice(0, 600)}`);
      }
    }
  });

  page.on("response", async (res) => {
    const url = res.url();
    const m = url.match(/\/rpc\/SearchService\/(\w+)/);
    if (!m) return;
    try {
      const body = await res.text();
      console.log(`[${m[1]}] response (first 600 chars):`);
      console.log(`  ${body.slice(0, 600)}`);
    } catch {}
  });

  console.log(`→ navigating, query=${QUERY}`);
  await page.goto(`https://adstransparency.google.com/?region=KR`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2500);
  const input = page.locator("input").first();
  await input.click();
  await input.fill(QUERY);
  await page.waitForTimeout(2500);

  // Click the first option that contains "example.co.kr" (the domain row)
  const options = await page.locator('[role="option"]').all();
  console.log(`\n  ${options.length} suggestions:`);
  for (let i = 0; i < options.length; i++) {
    const t = await options[i].textContent().catch(() => "");
    console.log(`  [${i}] ${t?.trim().slice(0, 80)}`);
  }

  // Try clicking the first one
  if (options.length > 0) {
    console.log(`\n→ clicking suggestion 0`);
    await options[0].click();
    await page.waitForTimeout(6000);
    console.log(`  current URL: ${page.url()}`);
  }

  await browser.close();
}

main().catch(console.error);
