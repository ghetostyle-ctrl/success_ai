/**
 * Diagnostic: open one Meta Ad Library detail URL and dump the
 * "광고주 정보" / "About the advertiser" section so we can find the
 * advertiser entity page_id selector.
 */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const adId = process.argv[2] || "1696447171479840";

async function main() {
  const url = `https://www.facebook.com/ads/library/?id=${adId}`;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  console.log(`→ ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);

  // Try to expand "광고주 정보" if it's collapsed.
  try {
    const advertiserHeader = page.getByText(/광고주 정보|About the advertiser/i).first();
    if (await advertiserHeader.count()) {
      await advertiserHeader.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
  } catch {}

  // Patterns:
  //   1) "ID: 428614080316734" right after the advertiser name
  //   2) <a href="/<pageId>"> next to the advertiser logo
  const result = await page.evaluate(() => {
    type Out = {
      idMatches: string[];
      advertiserCandidates: { name: string; href: string }[];
      sectionText: string | null;
    };
    const out: Out = { idMatches: [], advertiserCandidates: [], sectionText: null };

    // 1) Find "ID: <digits>" patterns (광고주 entity ID)
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null = walker.nextNode();
    while (n) {
      const t = (n.textContent || "").trim();
      const m = t.match(/^ID:\s*(\d{8,})/);
      if (m) out.idMatches.push(m[1]);
      n = walker.nextNode();
    }

    // 2) Find the advertiser-info section by anchor text
    const anchor = Array.from(document.querySelectorAll("*")).find((el) =>
      /^(?:광고주 정보|About the advertiser)/i.test(
        (el.textContent || "").trim()
      )
    );
    if (anchor) {
      // walk up and grab section content
      let block: HTMLElement | null = anchor as HTMLElement;
      for (let i = 0; i < 8 && block?.parentElement; i++) block = block.parentElement;
      if (block) {
        out.sectionText = block.textContent?.slice(0, 600) ?? null;
        // pull out anchor links inside the section
        for (const a of block.querySelectorAll("a")) {
          const href = (a as HTMLAnchorElement).href;
          const txt = (a.textContent || "").trim();
          if (
            href &&
            /facebook\.com\//i.test(href) &&
            !/\/ads\/library/i.test(href)
          ) {
            out.advertiserCandidates.push({ name: txt, href });
          }
        }
      }
    }
    return out;
  });

  console.log(JSON.stringify(result, null, 2));
  const html = await page.content();
  await writeFile(`/tmp/meta-detail-${adId}.html`, html);
  console.log(`saved /tmp/meta-detail-${adId}.html`);
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
