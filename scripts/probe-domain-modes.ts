/**
 * Probe brand-c.co.kr's ATC presence under multiple search modes
 * to figure out why domain mode only returned 5 ads.
 */
import { searchSuggestions, getAdsForAdvertisers, getAdsForDomain } from "../src/lib/atc-scraper";

async function main() {
  console.log("=== domain mode ===");
  const domAds = await getAdsForDomain("brand-c.co.kr", "KR", 40, 50);
  console.log(`brand-c.co.kr → ${domAds.length} ads`);
  for (const a of domAds) {
    console.log(`  ${a.creativeId}  type=${a.type}  advName="${a.advertiserName}"  advId=${a.advertiserId}`);
  }

  console.log("\n=== name candidates ===");
  const queries = [
    "무궁휘트",
    "무궁핏",
    "BrandC",
    "brand-c",
    "mugung fit",
    "무궁",
  ];
  for (const q of queries) {
    const r = await searchSuggestions(q, "KR");
    console.log(`[${q}]`);
    if (r.advertisers.length === 0 && r.domains.length === 0) {
      console.log("  (none)");
    }
    for (const a of r.advertisers) {
      console.log(`  ADV  ${a.advertiserId}  ${a.name}  (${a.adCountLow}-${a.adCountHigh})`);
    }
    for (const d of r.domains) {
      console.log(`  DOM  ${d.domain}`);
    }
  }

  // If we found any advertiser the 5 domain-mode ads point to, expand from there.
  const advIds = Array.from(new Set(domAds.map((a) => a.advertiserId)));
  if (advIds.length > 0) {
    console.log(`\n=== advertiser-id mode (${advIds.length} unique advertisers from domain hits) ===`);
    const advAds = await getAdsForAdvertisers(advIds, "KR", 40, 50);
    console.log(`→ ${advAds.length} ads (vs ${domAds.length} via domain)`);
  }
}
main().catch(console.error);
