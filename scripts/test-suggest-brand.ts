import { searchSuggestions } from "../src/lib/atc-scraper";
async function main() {
  const queries = ["예시브랜드", "EXAMPLE", "Example", "example", "example.co.kr", "예시브랜드 주식회사", "example88"];
  for (const q of queries) {
    try {
      const r = await searchSuggestions(q, "KR");
      console.log(`\n[${q}]`);
      console.log("  advertisers:", JSON.stringify(r.advertisers, null, 2));
      console.log("  domains:", JSON.stringify(r.domains, null, 2));
    } catch (e) {
      console.log(`[${q}] ERROR: ${(e as Error).message}`);
    }
  }
}
main().catch(console.error);
