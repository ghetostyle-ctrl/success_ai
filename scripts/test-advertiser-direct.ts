import { getAdsForAdvertisers } from "../src/lib/atc-scraper";
async function main() {
  // 크리에이팁 (example 대행사)
  const cases: { name: string; id: string }[] = [
    { name: "주식회사 크리에이팁 (example 대행사)", id: "AR17450630175812222977" },
  ];
  for (const c of cases) {
    console.log(`\n=== ${c.name} (${c.id}) ===`);
    const ads = await getAdsForAdvertisers([c.id], "KR", 40, 50, (i, n) =>
      console.log(`  page ${i}: +${n}`)
    );
    console.log(`총 ${ads.length}개`);
    const byBrand: Record<string, number> = {};
    for (const a of ads) {
      const brand = a.advertiserName || "(없음)";
      byBrand[brand] = (byBrand[brand] ?? 0) + 1;
    }
    console.log("브랜드별:", byBrand);
    // 도메인 분포 — previewUrl/imageHtml에서 destination 추출은 복잡하니 type만 본다
    const byType: Record<string, number> = {};
    for (const a of ads) byType[a.type] = (byType[a.type] ?? 0) + 1;
    console.log("type별:", byType);
  }
}
main().catch(console.error);
