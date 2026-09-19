import { searchSuggestions, getAdsForAdvertisers } from "../src/lib/atc-scraper";
async function main() {
  for (const q of ["예시샵", "주식회사 예시샵", "example-shop", "Nutrionic", "example-shop 주식회사"]) {
    const r = await searchSuggestions(q, "KR", { forceRefresh: true });
    console.log(`\n"${q}": advertisers=${r.advertisers.length}`);
    for (const a of r.advertisers.slice(0, 8)) console.log(`  ${a.advertiserId}  ${a.name}  (ads ${a.adCountLow}-${a.adCountHigh})`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
