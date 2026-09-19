/**
 * Diagnostic: hit Meta Ad Library directly with `view_all_page_id` for a
 * known advertiser page ID. The user pointed out that the brand's
 * advertiser entity (e.g. 브랜드A BrandA page_id=428614080316734)
 * surfaces ads that search_terms misses entirely — different sock-puppet
 * pages share the same advertiser, and Meta lets you scope by either.
 *
 * Usage: npx tsx scripts/probe-meta-page.ts <pageId>
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { searchByPageIdWeb } from "../src/lib/meta-scraper-web";
import { prisma } from "../src/lib/db";

async function main() {
  const pageId = process.argv[2];
  if (!pageId) {
    console.error("Usage: npx tsx scripts/probe-meta-page.ts <pageId>");
    process.exit(1);
  }
  console.log(`▶ scoping Meta Ad Library by page_id=${pageId}`);
  const ads = await searchByPageIdWeb(pageId, {
    maxScrolls: 30,
    onLog: (l) => console.log(" ", l),
  });
  console.log(`\ngot ${ads.length} ads from page ${pageId}`);

  // Cross-reference: which of these are NEW (not seen via search_terms)?
  const existingIds = new Set(
    (await prisma.metaAd.findMany({ select: { adArchiveId: true } })).map(
      (a) => a.adArchiveId
    )
  );
  const fresh = ads.filter((a) => !existingIds.has(a.adArchiveId));
  console.log(
    `  ↳ ${fresh.length} NEW (not yet in DB), ${ads.length - fresh.length} already known`
  );

  console.log("\n--- top 5 fresh ads ---");
  for (const a of fresh.slice(0, 5)) {
    console.log(
      `  [${a.pageName}] LP=${a.lpDomain ?? "?"} UTM=${a.utmCampaign ?? "?"}/${
        a.utmTerm ?? ""
      }`
    );
    if (a.bodies[0]) console.log(`    body: ${a.bodies[0].slice(0, 120)}`);
  }

  console.log("\n--- pages discovered (운영자 분포) ---");
  const byPage = new Map<string, number>();
  for (const a of ads) {
    if (!a.pageName) continue;
    byPage.set(a.pageName, (byPage.get(a.pageName) ?? 0) + 1);
  }
  for (const [name, n] of Array.from(byPage).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${name}`);
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
