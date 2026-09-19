import { getAdsForAdvertisers } from "../src/lib/atc-scraper";
async function main() {
  const advertiserId = "AR00888607439094546433";
  const targetCreativeId = "CR00850662605625229313";
  console.log(`\nProbing advertiser ${advertiserId} (KR), maxPages=50...`);
  const ads = await getAdsForAdvertisers([advertiserId], "KR", 40, 50, (i, n) => {
    console.log(`  page ${i}: +${n} ads`);
  });
  console.log(`\nTotal ads from ATC: ${ads.length}`);
  console.log("\n=== sample creative IDs ===");
  for (const a of ads.slice(0, 25)) {
    const isTarget = a.creativeId === targetCreativeId;
    console.log(`  ${isTarget ? "🎯 TARGET" : "       "} ${a.creativeId}  type=${a.type}  firstSeen=${a.firstSeen ?? "—"}`);
  }
  const found = ads.some(a => a.creativeId === targetCreativeId);
  console.log(`\n${found ? "✅" : "❌"} target ${targetCreativeId} ${found ? "FOUND" : "NOT FOUND"} in ATC response`);
}
main().catch(e => { console.error(e); process.exit(1); });
