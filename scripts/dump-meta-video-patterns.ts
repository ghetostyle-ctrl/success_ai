/**
 * Fresh dump of Meta Ad Library page for one keyword. Saves the
 * rendered HTML and reports which DOM signals reliably distinguish
 * video creatives from images. We need a stable selector before
 * adding mediaType to the scraper.
 */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

async function main() {
  const url =
    "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=KR&q=" +
    encodeURIComponent("브랜드A");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight)
    );
    await page.waitForTimeout(1500);
  }

  const stats = await page.evaluate(() => {
    const out = {
      videoTags: document.querySelectorAll("video").length,
      videoSrcs: Array.from(document.querySelectorAll("video[src]")).map(
        (v) => (v as HTMLVideoElement).src.slice(0, 80)
      ),
      videoPosters: Array.from(document.querySelectorAll("video[poster]")).map(
        (v) => (v as HTMLVideoElement).poster.slice(0, 80)
      ),
      ariaPlayLabels: Array.from(
        document.querySelectorAll("[aria-label]")
      )
        .map((el) => el.getAttribute("aria-label") || "")
        .filter((s) => /play|동영상|재생|동영상 재생/i.test(s))
        .slice(0, 5),
      // 비디오 마스크 sprite — Meta는 mask-image로 play icon 표시
      maskImages: Array.from(document.querySelectorAll('[style*="mask-image"]'))
        .map((el) => el.getAttribute("style") || "")
        .filter((s) => /mask-position/.test(s))
        .slice(0, 8)
        .map((s) => s.match(/mask-position[^;]*/)?.[0] ?? ""),
      // 광고 카드 sample: Library ID 노드 위 5단 ancestor의 video/img count
      cardSamples: (() => {
        const samples: { hasVideo: boolean; imgCount: number; libraryId: string }[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n: Node | null = walker.nextNode();
        while (n && samples.length < 8) {
          const t = (n.textContent || "").trim();
          const m = t.match(/(?:Library ID|라이브러리 ID):\s*(\d+)/);
          if (m) {
            let block = n.parentElement;
            for (let i = 0; i < 12 && block?.parentElement; i++)
              block = block.parentElement;
            samples.push({
              hasVideo: !!block?.querySelector("video"),
              imgCount: block?.querySelectorAll("img").length ?? 0,
              libraryId: m[1],
            });
          }
          n = walker.nextNode();
        }
        return samples;
      })(),
    };
    return out;
  });

  console.log("=== video signals ===");
  console.log(JSON.stringify(stats, null, 2));

  const html = await page.content();
  await writeFile("/tmp/meta-brand-a.html", html);
  console.log(
    `\nsaved /tmp/meta-brand-a.html (${(html.length / 1024).toFixed(0)} KB)`
  );
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
