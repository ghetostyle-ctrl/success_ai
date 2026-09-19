import { getAdsForDomain } from "../src/lib/atc-scraper";
async function main() {
  console.log("Probing domain example-shop.com (KR), pageSize=40, maxPages=20...");
  const ads = await getAdsForDomain("example-shop.com", "KR", 40, 20, (i, n) => {
    console.log(`  page ${i}: +${n} ads`);
  });
  console.log(`\nTotal ads from ATC domain search: ${ads.length}`);
  console.log(`\nUnique advertiser IDs:`);
  const adv = new Map<string, number>();
  for (const a of ads) adv.set(a.advertiserId, (adv.get(a.advertiserId) ?? 0) + 1);
  for (const [id, n] of adv) console.log(`  ${id}: ${n} ads (${ads.find(a=>a.advertiserId===id)?.advertiserName})`);
  console.log(`\nFirst 5 creatives:`);
  for (const a of ads.slice(0, 5)) {
    console.log(`  ${a.creativeId}  type=${a.type}  adv=${a.advertiserName}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
