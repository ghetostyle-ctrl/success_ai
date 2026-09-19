import { prisma } from "../src/lib/db";
async function main() {
  // YouTube-only jobs: those with no adCount but with resultCount,
  // and where kind wasn't explicitly set (likely from old /api/search calls)
  const result = await prisma.job.updateMany({
    where: {
      adCount: 0,
      resultCount: { gt: 0 },
      kind: "ad",
    },
    data: { kind: "youtube" },
  });
  console.log(`Fixed ${result.count} jobs to kind=youtube`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
