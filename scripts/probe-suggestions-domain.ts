import { searchSuggestions } from "../src/lib/atc-scraper";
async function main() {
  console.log("=== SearchSuggestions for 'example-shop.com' ===");
  const r = await searchSuggestions("example-shop.com", "KR", { forceRefresh: true });
  console.log(`advertisers: ${r.advertisers.length}`);
  for (const a of r.advertisers) console.log(`  ${a.advertiserId}  ${a.name}  (ads ${a.adCountLow}-${a.adCountHigh})`);
  console.log(`domains: ${r.domains.length}`);
  for (const d of r.domains) console.log(`  ${JSON.stringify(d)}`);
}
main().catch(e => { console.error(e); process.exit(1); });
