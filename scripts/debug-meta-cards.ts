/**
 * Diagnostic: visit fb.com/ads/library, dump the DOM around the first
 * "Library ID:" text node. Helps figure out which selectors actually
 * carry the page name, body text, dates, and platform glyphs so the
 * production extractor can target them.
 */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

async function main() {
  const url =
    "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=KR&q=example-shop";
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  console.log("→ navigating");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  console.log("→ scrolling");
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(2000);

  // Page title (sanity)
  const title = await page.title();
  console.log("title:", title);

  // Count Library ID matches
  const idCount = await page.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n = 0;
    let cur: Node | null = w.nextNode();
    while (cur) {
      const t = (cur.textContent || "").trim();
      if (/^(?:Library ID|라이브러리 ID):\s*\d+/.test(t)) n++;
      cur = w.nextNode();
    }
    return n;
  });
  console.log("Library ID matches:", idCount);

  // Dump the outerHTML of the FIRST card root (~3 levels up from the
  // ID text node) — this gives us a concrete tree to study.
  const sample = await page.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let cur: Node | null = w.nextNode();
    while (cur) {
      const t = (cur.textContent || "").trim();
      if (/^(?:Library ID|라이브러리 ID):\s*\d+/.test(t)) {
        let block: HTMLElement | null = cur.parentElement;
        for (let i = 0; i < 8 && block && block.parentElement; i++) {
          block = block.parentElement;
        }
        if (block) {
          // Trim to 6KB so the log isn't insane
          return block.outerHTML.slice(0, 6000);
        }
      }
      cur = w.nextNode();
    }
    return null;
  });
  console.log("first-card outerHTML (truncated 6KB):\n");
  console.log(sample ?? "(no card found)");

  // Save full snapshot
  const html = await page.content();
  await writeFile("/tmp/meta-library-snapshot.html", html);
  await page.screenshot({ path: "/tmp/meta-library-snapshot.png", fullPage: false });
  console.log("\nsaved /tmp/meta-library-snapshot.html (full)");
  console.log("saved /tmp/meta-library-snapshot.png (viewport)");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
