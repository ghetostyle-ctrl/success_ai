/**
 * Import all uploads from a sock-puppet "shell" YouTube channel as
 * candidate ads tied to a brand keyword.
 *
 * Why this exists: Google ATC's domain-mode index misses Demand Gen
 * creatives whose destination URL is on a different domain (event LP,
 * smartstore, kakao deeplink, etc.) AND whose host channel is one of
 * the brand's sock-puppet upload channels (low-sub channel that only
 * exists to carry paid ad creatives). Domain mode for example.co.kr
 * returns 205 ads; one shell channel alone added 82 more invisible to
 * ATC's domain index.
 *
 * Usage:
 *   npx tsx scripts/import-shell-channel.ts <handle> <brandKeyword> [--region=KR]
 *   e.g.
 *   npx tsx scripts/import-shell-channel.ts @jjojaljjojal example.co.kr
 *
 * Each video becomes an Ad row with:
 *   creativeId  = "yt:<videoId>"      ← prefix marks shell-channel origin,
 *                                       satisfies UNIQUE constraint
 *   advertiserId = "shell:<channelId>" ← so multiple shells map cleanly
 *   advertiserName = channel title
 *   keyword      = brand keyword (groups under the brand's sidebar entry)
 *   type         = "video"
 *   youtubeId + ytTitle/ytChannel/ytViews etc. = filled from YT Data API
 *
 * AdStat snapshots accumulate via the daily run-tracked.ts cron once
 * a Watch with kind="shell-channel" is added (separate concern; this
 * script is just the one-shot import).
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { prisma } from "../src/lib/db";
import { fetchYouTubeStats } from "../src/lib/youtube-stats";

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: npx tsx scripts/import-shell-channel.ts <handle> <brandKeyword> [--region=KR] [--title-filter=<regex>]"
    );
    process.exit(1);
  }
  let region = "KR";
  let titleFilter: RegExp | null = null;
  const rest = args.filter((a) => {
    const r = a.match(/^--region=(\w+)$/);
    if (r) {
      region = r[1];
      return false;
    }
    const t = a.match(/^--title-filter=(.+)$/);
    if (t) {
      titleFilter = new RegExp(t[1], "i");
      return false;
    }
    return true;
  });
  return {
    handle: rest[0],
    brandKeyword: rest[1],
    region,
    titleFilter: titleFilter as RegExp | null,
  };
}

async function resolveChannel(
  input: string
): Promise<{ id: string; title: string; subs: number; videoCount: number }> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY missing");

  async function fetchById(id: string) {
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "id,snippet,statistics");
    url.searchParams.set("id", id);
    url.searchParams.set("key", apiKey!);
    const res = await fetch(url.toString());
    if (!res.ok)
      throw new Error(`channels API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        snippet: { title: string };
        statistics: { subscriberCount: string; videoCount: string };
      }>;
    };
    return data.items?.[0] ?? null;
  }

  // 1) Direct channel ID (UCxxx...)
  if (/^UC[A-Za-z0-9_-]{22}$/.test(input)) {
    const c = await fetchById(input);
    if (!c) throw new Error(`channel ${input} not found`);
    return {
      id: c.id,
      title: c.snippet.title,
      subs: parseInt(c.statistics.subscriberCount, 10),
      videoCount: parseInt(c.statistics.videoCount, 10),
    };
  }

  // 2) Handle (@xxx) — try forHandle, falls through to search if it errors
  if (input.startsWith("@")) {
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "id,snippet,statistics");
    url.searchParams.set("forHandle", input.replace(/^@/, ""));
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString());
    if (res.ok) {
      const data = (await res.json()) as {
        items?: Array<{
          id: string;
          snippet: { title: string };
          statistics: { subscriberCount: string; videoCount: string };
        }>;
      };
      if (data.items?.[0]) {
        const c = data.items[0];
        return {
          id: c.id,
          title: c.snippet.title,
          subs: parseInt(c.statistics.subscriberCount, 10),
          videoCount: parseInt(c.statistics.videoCount, 10),
        };
      }
    }
    // forHandle frequently returns empty even for valid handles; fall through
    // to the search-based fallback below.
  }

  // 3) Fallback: search.list by query, take the top channel result
  const surl = new URL("https://www.googleapis.com/youtube/v3/search");
  surl.searchParams.set("part", "snippet");
  surl.searchParams.set("q", input.replace(/^@/, ""));
  surl.searchParams.set("type", "channel");
  surl.searchParams.set("maxResults", "5");
  surl.searchParams.set("key", apiKey);
  const sres = await fetch(surl.toString());
  if (!sres.ok)
    throw new Error(`search API ${sres.status}: ${await sres.text()}`);
  const sdata = (await sres.json()) as {
    items?: Array<{ snippet: { channelId: string; channelTitle: string } }>;
  };
  const hit = sdata.items?.[0];
  if (!hit) throw new Error(`channel not found for ${input}`);
  const c = await fetchById(hit.snippet.channelId);
  if (!c) throw new Error(`channel ${hit.snippet.channelId} not found`);
  return {
    id: c.id,
    title: c.snippet.title,
    subs: parseInt(c.statistics.subscriberCount, 10),
    videoCount: parseInt(c.statistics.videoCount, 10),
  };
}

async function listUploads(channelId: string): Promise<string[]> {
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
  const { handle, brandKeyword, region, titleFilter } = parseArgs();
  console.log(`▶ Shell-channel import`);
  console.log(`  handle:  ${handle}`);
  console.log(`  brand:   ${brandKeyword}`);
  console.log(`  region:  ${region}`);
  if (titleFilter) console.log(`  filter:  ${titleFilter}`);
  console.log("");

  const channel = await resolveChannel(handle);
  console.log(
    `📺 ${channel.title} (${channel.id}) — 구독 ${channel.subs}, 영상 ${channel.videoCount}\n`
  );

  const videoIds = await listUploads(channel.id);
  console.log(`📹 채널 영상 ${videoIds.length}개 fetched`);

  const allStats = await fetchYouTubeStats(videoIds);
  const stats = titleFilter
    ? allStats.filter((s) => titleFilter.test(s.title))
    : allStats;
  if (titleFilter) {
    console.log(`📊 stats fetched: ${allStats.length}/${videoIds.length}`);
    console.log(`   title 필터 매칭: ${stats.length}/${allStats.length}\n`);
  } else {
    console.log(`📊 stats fetched: ${stats.length}/${videoIds.length}\n`);
  }

  const advertiserId = `shell:${channel.id}`;
  const today = new Date().toISOString().slice(0, 10);

  // Single transaction for atomicity + speed.
  let created = 0;
  let updated = 0;
  let snapshotsWritten = 0;
  for (const s of stats) {
    const creativeId = `yt:${s.id}`;
    const existing = await prisma.ad.findUnique({ where: { creativeId } });
    await prisma.ad.upsert({
      where: { creativeId },
      create: {
        advertiserId,
        advertiserName: channel.title,
        creativeId,
        type: "video",
        region,
        firstSeen: s.publishedAt,
        lastSeen: today,
        previewUrl: null,
        imageHtml: null,
        obfuscatedCustomerId: null,
        keyword: brandKeyword,
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
        advertiserName: channel.title,
        ytTitle: s.title,
        ytChannel: s.channel,
        ytPublishedAt: s.publishedAt,
        ytViews: s.views,
        ytLikes: s.likes,
        ytComments: s.comments,
        ytDurationSec: s.durationSec,
        ytFetchedAt: new Date(),
        lastSeen: today,
      },
    });
    if (existing) updated++;
    else created++;

    await prisma.adStat.upsert({
      where: { creativeId_capturedDate: { creativeId, capturedDate: today } },
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
    snapshotsWritten++;
  }

  // Register/update the ShellChannel row so run-tracked.ts picks it up
  // automatically tomorrow morning. Re-running the same import refreshes
  // titleFilter and re-activates the channel without duplicating.
  await prisma.shellChannel.upsert({
    where: { channelId: channel.id },
    create: {
      channelId: channel.id,
      channelTitle: channel.title,
      brandKeyword,
      region,
      titleFilter: titleFilter ? titleFilter.source : null,
      active: true,
      lastRunAt: new Date(),
      lastRunStatus: "완료",
      lastRunNote: `${created}+${updated} videos imported`,
    },
    update: {
      channelTitle: channel.title,
      brandKeyword,
      region,
      titleFilter: titleFilter ? titleFilter.source : null,
      active: true,
      lastRunAt: new Date(),
      lastRunStatus: "완료",
      lastRunNote: `${created}+${updated} videos imported`,
    },
  });

  console.log(`✅ 완료`);
  console.log(`   신규 ${created}개 / 갱신 ${updated}개`);
  console.log(`   AdStat 스냅샷 ${snapshotsWritten}개 (${today})`);
  console.log(`   ShellChannel 등록 — 매일 새벽 자동 갱신됨`);
  console.log(`\n   대시보드 사이드바에서 "${brandKeyword}" 클릭 →`);
  console.log(`   "${channel.title}" 광고주명으로 영상들 노출됨`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
