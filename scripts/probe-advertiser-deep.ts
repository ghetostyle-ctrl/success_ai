import { getAdsForAdvertisers } from "../src/lib/atc-scraper";
async function main() {
  // ATC suggestion claims AR00888... has 42 ads. Force max pages to verify.
  const ads = await getAdsForAdvertisers(["AR00888607439094546433"], "KR", 40, 100, (i, n) => {
    console.log(`  page ${i}: +${n} (cumulative ATC says: ${n})`);
  });
  console.log(`\nTotal returned: ${ads.length}`);
  console.log(`Distinct creative IDs: ${new Set(ads.map(a => a.creativeId)).size}`);
}
main().catch(e => { console.error(e); process.exit(1); });
