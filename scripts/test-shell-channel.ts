/**
 * Discover ad-creative shell channels by:
 *  1. Resolve a handle (@jjojaljjojal) → channelId
 *  2. List all uploads on that channel
 *  3. Cross-reference video IDs against existing Ad table (matched / new)
 *  4. For new ones, fetch stats so we can spot the high-view ad creatives
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { prisma } from "../src/lib/db";
import { fetchYouTubeStats } from "../src/lib/youtube-stats";

const HANDLE = process.argv[2] ?? "@jjojaljjojal";
const KNOWN_VIDEO_ID = "IZfqgGjMjnQ";

async function resolveChannelId(handle: string): Promise<string> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY missing");
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "id,snippet,statistics");
  url.searchParams.set("forHandle", handle.replace(/^@/, ""));
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`channels API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      snippet: { title: string; publishedAt: string };
      statistics: { subscriberCount: string; videoCount: string; viewCount: string };
    }>;
  };
  if (!data.items || data.items.length === 0) {
    // fallback: try video lookup → channelId
    const v = new URL("https://www.googleapis.com/youtube/v3/videos");
    v.searchParams.set("part", "snippet");
    v.searchParams.set("id", KNOWN_VIDEO_ID);
    v.searchParams.set("key", apiKey);
    const vr = await fetch(v.toString());
    const vd = (await vr.json()) as {
      items?: Array<{ snippet: { channelId: string; channelTitle: string } }>;
    };
    if (vd.items?.[0]) {
      console.log(`(handle resolve fail, fell back to video lookup)`);
      console.log(`  → channel: ${vd.items[0].snippet.channelTitle} (${vd.items[0].snippet.channelId})`);
      return vd.items[0].snippet.channelId;
    }
    throw new Error("could not resolve channel");
  }
  const c = data.items[0];
  console.log(`채널: ${c.snippet.title}`);
  console.log(`  ID: ${c.id}`);
  console.log(`  구독자: ${c.statistics.subscriberCount}`);
  console.log(`  영상 수: ${c.statistics.videoCount}`);
  console.log(`  총 조회: ${c.statistics.viewCount}`);
  console.log(`  생성일: ${c.snippet.publishedAt}`);
  return c.id;
}

async function listUploads(channelId: string): Promise<string[]> {
  const apiKey = process.env.YOUTUBE_API_KEY!;
  // The uploads playlist is just channelId with UC→UU prefix swap
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
    if (!res.ok) {
      console.error(`playlist API ${res.status}: ${await res.text()}`);
      break;
    }
    const data = (await res.json()) as {
      items?: Array<{ contentDetails: { videoId: string } }>;
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) ids.push(item.contentDetails.videoId);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return ids;
}

async function main() {
  console.log(`=== Shell-channel probe: ${HANDLE} ===\n`);
  const channelId = await resolveChannelId(HANDLE);
  console.log("");

  const videoIds = await listUploads(channelId);
  console.log(`📹 채널 영상 총 ${videoIds.length}개 (UU playlist)`);

  // Cross-reference with existing Ad table
  const existingAds = await prisma.ad.findMany({
    where: { youtubeId: { in: videoIds } },
    select: { youtubeId: true, keyword: true, advertiserName: true },
  });
  const existingSet = new Set(existingAds.map((a) => a.youtubeId));
  const newOnes = videoIds.filter((v) => !existingSet.has(v));
  console.log(`  └ 우리 DB에 이미 있는 광고: ${existingAds.length}개`);
  console.log(`  └ 신규 (등록 안 됨): ${newOnes.length}개\n`);

  // Pull stats for the unknown ones to spot the high-view ad creatives
  console.log(`📊 신규 ${newOnes.length}개 stats 수집...\n`);
  const stats = await fetchYouTubeStats(newOnes);
  stats.sort((a, b) => b.views - a.views);
  console.log(`Top 20 by views:`);
  console.log("─".repeat(110));
  for (const s of stats.slice(0, 20)) {
    const v = s.views.toLocaleString().padStart(12);
    const t = s.title.length > 60 ? s.title.slice(0, 60) + "…" : s.title;
    console.log(`  ${v}  ${s.publishedAt}  ${s.id}  ${t}`);
  }
  console.log("─".repeat(110));
  const total = stats.reduce((sum, s) => sum + s.views, 0);
  console.log(`\n채널 총 노출: ${total.toLocaleString()}회 (이 중 우리 DB는 ${existingAds.length}/${videoIds.length})`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
