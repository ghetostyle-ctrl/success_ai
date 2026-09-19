/**
 * brand-d.co.kr 도메인 검색 결과의 실제 SearchCreatives 응답을 처음 5
 * 페이지까지 dump. 목적: 우리 도구는 첫 페이지 2개만 받고 cursor 없어서
 * 끝나는데 ATC 사이트는 3000개 받음 → 응답에 cursor(field "2") 가 있는지,
 * 페이지당 ad 갯수 (field "1".length) 가 얼마인지 확인.
 *
 * chromium 직접 IP 라 IPRoyal 트래픽 0.
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

  let pageNum = 0;
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("/rpc/SearchService/SearchCreatives")) return;
    pageNum++;
    try {
      const body = await res.text();
      // ATC RPC returns: )]}'\n + JSON
      const json = body.replace(/^\)\]\}'\n?/, "");
      const data = JSON.parse(json);
      const ads = data["1"] ?? [];
      const cursor = data["2"];
      const adIds = ads
        .slice(0, 3)
        .map((a: { "2"?: string }) => a["2"])
        .join(", ");
      console.log(
        `[page ${pageNum}] ads=${ads.length}  cursor=${
          cursor ? cursor.slice(0, 40) + "..." : "NONE"
        }  first3=${adIds}`
      );
    } catch (e) {
      console.log(`[page ${pageNum}] parse fail: ${(e as Error).message}`);
      console.log(`  body[0..200]=${(await res.text()).slice(0, 200)}`);
    }
  });

  console.log(`→ navigating to ATC, query=${QUERY}`);
  await page.goto(`https://adstransparency.google.com/?region=KR`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2500);
  const input = page.locator("input").first();
  await input.click();
  await input.fill(QUERY);
  await page.waitForTimeout(2500);

  const options = await page.locator('[role="option"]').all();
  console.log(`\n${options.length} suggestions`);
  if (options.length === 0) {
    console.error("no suggestions, abort");
    await browser.close();
    return;
  }
  await options[0].click();
  await page.waitForTimeout(4000);

  // Scroll to trigger more pages — ATC lazy-loads on scroll.
  console.log(`\n→ scrolling to trigger pagination...`);
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(2000);

  console.log(`\nTotal SearchCreatives RPC calls: ${pageNum}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
