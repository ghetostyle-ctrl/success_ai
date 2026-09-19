import { scrapeAds } from "../src/lib/atc-scraper";
async function main() {
  console.log("starting paginated fetch...");
  const t0 = Date.now();
  const r = await scrapeAds("example.co.kr", {
    maxPages: 6,
    onPage: (i, total) => console.log(`  page ${i}: total ${total}`),
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nGot ${r.ads.length} ads in ${dt}s. types:`);
  const t: Record<string, number> = {};
  for (const a of r.ads) t[a.type] = (t[a.type] ?? 0) + 1;
  console.log(t);
}
main().catch(console.error);
