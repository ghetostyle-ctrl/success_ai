/**
 * For every brand keyword in the Ad table, list the YouTube channels
 * its creatives live on, score each as shell-puppet candidate, and
 * print ready-to-run import commands.
 *
 * Goal: surface the channels we know about (because some of their videos
 * already hit ATC's domain index) so we can pull the rest of the channel.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { prisma } from "../src/lib/db";

const SUB_MAX = 10_000;
const VID_MIN = 5;
const VID_MAX = 800;
const AVG_VIEWS_MIN = 30_000;

async function channelInfoFromVideo(
  videoId: string
): Promise<{ id: string; subs: number; videos: number; totalViews: number } | null> {
  const apiKey = process.env.YOUTUBE_API_KEY!;
  // 1) video → channelId (authoritative; no name disambiguation problem)
  const vurl = new URL("https://www.googleapis.com/youtube/v3/videos");
  vurl.searchParams.set("part", "snippet");
  vurl.searchParams.set("id", videoId);
  vurl.searchParams.set("key", apiKey);
  const vres = await fetch(vurl.toString());
  if (!vres.ok) return null;
  const vdata = (await vres.json()) as {
    items?: Array<{ snippet: { channelId: string } }>;
  };
  const channelId = vdata.items?.[0]?.snippet.channelId;
  if (!channelId) return null;

  // 2) channelId → stats
  const curl = new URL("https://www.googleapis.com/youtube/v3/channels");
  curl.searchParams.set("part", "statistics");
  curl.searchParams.set("id", channelId);
  curl.searchParams.set("key", apiKey);
  const cres = await fetch(curl.toString());
  if (!cres.ok) return null;
  const cdata = (await cres.json()) as {
    items?: Array<{
      statistics: { subscriberCount?: string; videoCount?: string; viewCount?: string };
    }>;
  };
  const c = cdata.items?.[0];
  if (!c) return null;
  return {
    id: channelId,
    subs: parseInt(c.statistics.subscriberCount ?? "0", 10),
    videos: parseInt(c.statistics.videoCount ?? "0", 10),
    totalViews: parseInt(c.statistics.viewCount ?? "0", 10),
  };
}

async function main() {
  // Pull a sample youtubeId per (keyword, channel) so we can authoritatively
  // resolve channelId without name-collision via search.list.
  const rows = await prisma.$queryRaw<
    Array<{
      keyword: string;
      ytChannel: string;
      ads: number;
      avg_views: number;
      max_views: number;
      sample_video: string;
    }>
  >`SELECT keyword, ytChannel, COUNT(*) AS ads, CAST(AVG(ytViews) AS INTEGER) AS avg_views, MAX(ytViews) AS max_views, MAX(youtubeId) AS sample_video FROM Ad WHERE ytChannel IS NOT NULL AND youtubeId IS NOT NULL AND advertiserId NOT LIKE 'shell:%' GROUP BY keyword, ytChannel ORDER BY keyword, ads DESC`;

  // group by domain
  const byDomain = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byDomain.get(r.keyword) ?? [];
    arr.push(r);
    byDomain.set(r.keyword, arr);
  }

  // exclude channels that are already imported
  const imported = await prisma.shellChannel.findMany({ select: { channelTitle: true } });
  const importedTitles = new Set(imported.map((s) => s.channelTitle));

  for (const [domain, channels] of byDomain) {
    console.log(`\n══════════════════════════════════════════════════════════════════════════════`);
    console.log(`📍 ${domain}`);
    console.log(`══════════════════════════════════════════════════════════════════════════════`);
    for (const ch of channels) {
      if (importedTitles.has(ch.ytChannel)) {
        console.log(`  ${ch.ytChannel.padEnd(36)}  ATC ${String(ch.ads).padStart(4)}  ✓ already imported`);
        continue;
      }
      // skip Google internal upload-bot names
      if (/^Video ad upload channel/i.test(ch.ytChannel)) {
        console.log(`  ${ch.ytChannel.padEnd(36)}  ATC ${String(ch.ads).padStart(4)}  (Google upload-bot, skip)`);
        continue;
      }
      const info = await channelInfoFromVideo(ch.sample_video);
      if (!info) {
        console.log(`  ${ch.ytChannel.padEnd(36)}  ATC ${String(ch.ads).padStart(4)}  ⚠ channel lookup failed (video: ${ch.sample_video})`);
        continue;
      }
      const avg = info.videos > 0 ? Math.round(info.totalViews / info.videos) : 0;
      const isShell =
        info.subs < SUB_MAX &&
        info.videos >= VID_MIN &&
        info.videos <= VID_MAX &&
        avg >= AVG_VIEWS_MIN;
      const tag = isShell ? "✅ SHELL" : "  ";
      console.log(
        `  ${ch.ytChannel.padEnd(36)}  ATC ${String(ch.ads).padStart(4)}  ${tag}  subs=${String(info.subs).padStart(7)}  videos=${String(info.videos).padStart(4)}  avg=${avg.toLocaleString().padStart(10)}  ${info.id}`
      );
      if (isShell) {
        // suggest import command, no title-filter (we trust the channel narrowly serves this brand)
        console.log(`     └─ npx tsx scripts/import-shell-channel.ts ${info.id} ${domain}`);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
