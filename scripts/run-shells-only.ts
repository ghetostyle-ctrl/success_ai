/**
 * Same shell-channel refresh that run-tracked.ts does, but skipping
 * ad watches. Useful for testing the shell-channel pipeline without
 * waiting on the full ATC scrape.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { prisma } from "../src/lib/db";
import { fetchYouTubeStats } from "../src/lib/youtube-stats";

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
function log(msg: string) {
  console.log(`[${ts()}] ${msg}`);
}

async function listChannelUploads(channelId: string): Promise<string[]> {
  const apiKey = process.env.YOUTUBE_API_KEY!;
  const playlistId = "UU" + channelId.slice(2);
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString());
    if (!res.ok)
      throw new Error(`playlist API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      items?: Array<{ contentDetails: { videoId: string } }>;
      nextPageToken?: string;
    };
    for (const it of data.items ?? []) ids.push(it.contentDetails.videoId);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return ids;
}

async function main() {
  const shells = await prisma.shellChannel.findMany({ where: { active: true } });
  log(`Found ${shells.length} active shell channel(s)`);

  for (const sc of shells) {
    log(`▶ ${sc.channelTitle} (${sc.channelId}) → ${sc.brandKeyword}`);
    try {
      const videoIds = await listChannelUploads(sc.channelId);
      const allStats = await fetchYouTubeStats(videoIds);
      const filterRe = sc.titleFilter ? new RegExp(sc.titleFilter, "i") : null;
      const stats = filterRe
        ? allStats.filter((s) => filterRe.test(s.title))
        : allStats;
      log(`  📹 영상 ${videoIds.length} → 필터 매칭 ${stats.length}`);

      const today = new Date().toISOString().slice(0, 10);
      const advertiserId = `shell:${sc.channelId}`;
      let created = 0;
      let updated = 0;

      for (const s of stats) {
        const creativeId = `yt:${s.id}`;
        const existing = await prisma.ad.findUnique({ where: { creativeId } });
        await prisma.ad.upsert({
          where: { creativeId },
          create: {
            advertiserId,
            advertiserName: sc.channelTitle,
            creativeId,
            type: "video",
            region: sc.region,
            firstSeen: s.publishedAt,
            lastSeen: today,
            keyword: sc.brandKeyword,
            youtubeId: s.id,
            ytTitle: s.title,
            ytChannel: s.channel,
            ytPublishedAt: s.publishedAt,
            ytViews: s.views,
            ytLikes: s.likes,
            ytComments: s.comments,
            ytDurationSec: s.durationSec,
            ytFetchedAt: new Date(),
          },
          update: {
            ytTitle: s.title,
            ytViews: s.views,
            ytLikes: s.likes,
            ytComments: s.comments,
            ytFetchedAt: new Date(),
            lastSeen: today,
          },
        });
        if (existing) updated++;
        else created++;

        await prisma.adStat.upsert({
          where: {
            creativeId_capturedDate: { creativeId, capturedDate: today },
          },
          create: {
            creativeId,
            capturedDate: today,
            views: s.views,
            likes: s.likes,
            comments: s.comments,
          },
          update: {
            views: s.views,
            likes: s.likes,
            comments: s.comments,
            capturedAt: new Date(),
          },
        });
      }

      const note = `신규 ${created} / 갱신 ${updated}`;
      await prisma.shellChannel.update({
        where: { id: sc.id },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: "완료",
          lastRunNote: note,
        },
      });
      log(`  ✅ ${note}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      log(`  ❌ ${msg}`);
    }
  }

  log("Done.");
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
