/**
 * Seed today's AdStat snapshot from the current ytViews/likes/comments
 * stored on each Ad. Without this, the time-series view starts empty.
 */
import { prisma } from "../src/lib/db";

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const ads = await prisma.ad.findMany({
    where: {
      youtubeId: { not: null },
      ytViews: { not: null },
    },
  });
  console.log(`Backfilling ${ads.length} ads with today's snapshot...`);
  let upserted = 0;
  for (const ad of ads) {
    if (ad.ytViews === null) continue;
    await prisma.adStat.upsert({
      where: {
        creativeId_capturedDate: {
          creativeId: ad.creativeId,
          capturedDate: today,
        },
      },
      create: {
        creativeId: ad.creativeId,
        capturedDate: today,
        views: ad.ytViews,
        likes: ad.ytLikes ?? 0,
        comments: ad.ytComments ?? 0,
      },
      update: {
        views: ad.ytViews,
        likes: ad.ytLikes ?? 0,
        comments: ad.ytComments ?? 0,
      },
    });
    upserted++;
  }
  console.log(`✓ Upserted ${upserted} snapshots for ${today}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
