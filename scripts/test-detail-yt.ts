/**
 * Test: visiting individual ad creative URLs in ATC.
 * Each URL like /advertiser/AR.../creative/CR...?region=KR shows one ad
 * in detail. This may load YouTube content more reliably.
 */
import { chromium } from "playwright";

async function main() {
  // First get list of example-shop.com ads from the public RPC
  const adsRes = await fetch(
    "https://adstransparency.google.com/anji/_/rpc/SearchService/SearchCreatives?authuser=",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-same-domain": "1",
        referer: "https://adstransparency.google.com/?region=KR",
      },
      body:
        "f.req=" +
        encodeURIComponent(
          JSON.stringify({
            "2": 40,
            "3": {
              "8": [2410],
              "12": { "1": "example-shop.com", "2": true },
            },
            "7": { "1": 1, "2": 0, "3": 2410 },
          })
        ),
    }
  );
  const data = (await adsRes.json()) as { "1"?: Array<Record<string, unknown>> };
  const ads = (data["1"] ?? []) as Array<{
    "1": string;
    "2": string;
    "4"?: number;
  }>;
  const videoAds = ads.filter((a) => a["4"] === 2 || a["4"] === 3);
  console.log(`Got ${ads.length} total, ${videoAds.length} video/other ads`);

  // Visit first 5 detail URLs
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1366, height: 900 },
  });

  const ids = new Set<string>();
  const adToYt = new Map<string, string>();

  for (const ad of videoAds.slice(0, 8)) {
    const page = await context.newPage();
    const localIds = new Set<string>();
    page.on("request", (req) => {
      const m =
        req
          .url()
          .match(
            /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/|i\.ytimg\.com\/vi\/)([\w-]{11})/
          );
      if (m) {
        localIds.add(m[1]);
        ids.add(m[1]);
      }
    });

    const url = `https://adstransparency.google.com/advertiser/${ad["1"]}/creative/${ad["2"]}?region=KR`;
    console.log(`→ ${ad["2"]}`);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(5000);
      // Try clicking play button if visible
      const playButton = page
        .locator('button[aria-label*="play" i], button[aria-label*="재생"]')
        .first();
      if (await playButton.count()) {
        await playButton.click({ timeout: 1000 }).catch(() => {});
      }
      await page.waitForTimeout(3000);
    } catch {}

    if (localIds.size > 0) {
      const yid = Array.from(localIds)[0];
      adToYt.set(ad["2"], yid);
      console.log(`  ✓ ${yid}`);
    } else {
      console.log(`  - no YT`);
    }
    await page.close();
  }

  await browser.close();
  console.log(`\nMatched ${adToYt.size} ads → YouTube IDs`);
  for (const [cr, yt] of adToYt) {
    console.log(`  ${cr} → https://youtu.be/${yt}`);
  }
  console.log(`\nUnique YT IDs found: ${ids.size}`);
}
main().catch(console.error);
