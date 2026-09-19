import { prisma } from "../src/lib/db";
async function main() {
  const result = await prisma.ad.updateMany({
    where: {
      type: "video",
      previewUrl: null,
      imageHtml: { not: null },
    },
    data: { type: "image" },
  });
  console.log(`Re-classified ${result.count} video ads to image (had imageHtml only)`);
  // Counts after
  const types = await prisma.ad.groupBy({
    by: ["type"],
    _count: true,
  });
  console.log("Type distribution after fix:");
  for (const t of types) console.log(`  ${t.type}: ${t._count}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
