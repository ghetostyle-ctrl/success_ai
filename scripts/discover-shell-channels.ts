/**
 * Discover candidate shell-puppet YouTube channels for a brand by:
 *   1. YT search.list across brand-signature query patterns
 *   2. Aggregate channels by hit count
 *   3. Pull each channel's stats (subs, videoCount, totalViews)
 *   4. Score with shell signature heuristic:
 *       - subs < SUB_MAX
 *       - videoCount in [VID_MIN, VID_MAX]
 *       - avg views per video > AVG_VIEWS_MIN
 *      Channels passing all three are auto-marked "likely shell"; others
 *      are reported but require human review.
 *
 * Already-imported channels are flagged so a re-run won't double-count.
 *
 * Usage:
 *   npx tsx scripts/discover-shell-channels.ts <brandKeyword> [--queries=...]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { prisma } from "../src/lib/db";

const SUB_MAX = 5000; // a real beauty channel has way more
const VID_MIN = 5; // ignore one-shot test channels
const VID_MAX = 500; // shell channels rarely exceed a few hundred uploads
const AVG_VIEWS_MIN = 50_000; // ad-promoted videos pull crowds

const BRAND_QUERY_PRESETS: Record<string, string[]> = {
  "example.co.kr": [
    "연예인 100통 틴트",
    "산다라박 틴트",
    "송가인 100통 틴트",
    "이수현 틴트",
    "지속력 틴트 안지워지는",
    "여자 연예인 파우치 틴트",
    "뮤지컬 무대 틴트",
    "예시브랜드 틴트",
    "EXAMPLE 틴트",
    "100통 산 틴트",
  ],
};

type SearchHit = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
};

async function ytSearch(query: string, max = 25): Promise<SearchHit[]> {
  const apiKey = process.env.YOUTUBE_API_KEY!;
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "video");
  url.searchParams.set("regionCode", "KR");
  url.searchParams.set("relevanceLanguage", "ko");
  url.searchParams.set("maxResults", String(max));
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) {
    console.error(`  ⚠ search "${query}": ${res.status} ${(await res.text()).slice(0, 100)}`);
    return [];
  }
  const data = (await res.json()) as {
    items?: Array<{
      id: { videoId: string };
      snippet: { channelId: string; channelTitle: string; title: string };
    }>;
  };
  return (data.items ?? [])
    .filter((it) => it.id?.videoId)
    .map((it) => ({
      videoId: it.id.videoId,
      channelId: it.snippet.channelId,
      channelTitle: it.snippet.channelTitle,
      title: it.snippet.title,
    }));
}

type ChannelMeta = {
  id: string;
  title: string;
  subs: number;
  videoCount: number;
  totalViews: number;
};

async function fetchChannels(ids: string[]): Promise<ChannelMeta[]> {
  const apiKey = process.env.YOUTUBE_API_KEY!;
  const out: ChannelMeta[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "id,snippet,statistics");
    url.searchParams.set("id", chunk.join(","));
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error(`  ⚠ channels.list ${res.status}: ${(await res.text()).slice(0, 100)}`);
      continue;
    }
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        snippet: { title: string };
        statistics: {
          subscriberCount?: string;
          videoCount?: string;
          viewCount?: string;
        };
      }>;
    };
    for (const c of data.items ?? []) {
      out.push({
        id: c.id,
        title: c.snippet.title,
        subs: parseInt(c.statistics.subscriberCount ?? "0", 10),
        videoCount: parseInt(c.statistics.videoCount ?? "0", 10),
        totalViews: parseInt(c.statistics.viewCount ?? "0", 10),
      });
    }
  }
  return out;
}

async function alreadyImported(channelId: string): Promise<number> {
  return prisma.ad.count({
    where: { advertiserId: `shell:${channelId}` },
  });
}

async function main() {
  const brand = process.argv[2];
  if (!brand) {
    console.error("Usage: npx tsx scripts/discover-shell-channels.ts <brandKeyword>");
    process.exit(1);
  }
  const queries = BRAND_QUERY_PRESETS[brand];
  if (!queries) {
    console.error(`No query preset for brand "${brand}". Edit BRAND_QUERY_PRESETS in this script.`);
    process.exit(1);
  }
  console.log(`▶ Shell-channel discovery for ${brand}`);
  console.log(`  ${queries.length} query patterns\n`);

  // Stage 1: search and aggregate channels
  const channelHits = new Map<string, { title: string; hits: Set<string>; sampleTitles: string[] }>();
  for (const q of queries) {
    process.stdout.write(`  🔎 "${q}" ... `);
    const hits = await ytSearch(q);
    console.log(`${hits.length} videos`);
    for (const h of hits) {
      const slot = channelHits.get(h.channelId) ?? {
        title: h.channelTitle,
        hits: new Set<string>(),
        sampleTitles: [],
      };
      slot.hits.add(h.videoId);
      if (slot.sampleTitles.length < 3) slot.sampleTitles.push(h.title);
      channelHits.set(h.channelId, slot);
    }
  }
  console.log(`\n📺 Unique channels found: ${channelHits.size}\n`);

  // Stage 2: fetch stats for all hit channels
  const channelIds = Array.from(channelHits.keys());
  const channels = await fetchChannels(channelIds);
  const channelMap = new Map(channels.map((c) => [c.id, c]));

  // Stage 3: classify
  type Row = {
    id: string;
    title: string;
    subs: number;
    videoCount: number;
    totalViews: number;
    avgViews: number;
    hitCount: number;
    sampleTitles: string[];
    isShell: boolean;
    alreadyImported: number;
  };
  const rows: Row[] = [];
  for (const [id, slot] of channelHits) {
    const c = channelMap.get(id);
    if (!c) continue;
    const avgViews = c.videoCount > 0 ? Math.round(c.totalViews / c.videoCount) : 0;
    const isShell =
      c.subs < SUB_MAX &&
      c.videoCount >= VID_MIN &&
      c.videoCount <= VID_MAX &&
      avgViews >= AVG_VIEWS_MIN;
    rows.push({
      id,
      title: c.title,
      subs: c.subs,
      videoCount: c.videoCount,
      totalViews: c.totalViews,
      avgViews,
      hitCount: slot.hits.size,
      sampleTitles: slot.sampleTitles,
      isShell,
      alreadyImported: await alreadyImported(id),
    });
  }

  // Sort: shell-likely first, then by hit count
  rows.sort((a, b) => {
    if (a.isShell !== b.isShell) return a.isShell ? -1 : 1;
    return b.hitCount - a.hitCount;
  });

  console.log(`📊 Channel signature analysis`);
  console.log(`   shell criteria: subs<${SUB_MAX} · videos in [${VID_MIN},${VID_MAX}] · avgViews>${AVG_VIEWS_MIN.toLocaleString()}\n`);
  console.log(
    "─".repeat(140)
  );
  console.log(
    "  HIT  SHELL  IMPORTED  SUBS    VIDS  AVG_VIEWS    CHANNEL_ID                  TITLE"
  );
  console.log(
    "─".repeat(140)
  );
  for (const r of rows.slice(0, 30)) {
    const shellMark = r.isShell ? "✅" : "  ";
    const importMark = r.alreadyImported > 0 ? `✓${r.alreadyImported}` : "  ";
    console.log(
      `  ${String(r.hitCount).padStart(3)}  ${shellMark}    ${importMark.padStart(7)}  ${String(r.subs).padStart(6)}  ${String(r.videoCount).padStart(4)}  ${r.avgViews.toLocaleString().padStart(10)}  ${r.id}  ${r.title}`
    );
  }
  console.log("─".repeat(140));

  const newShells = rows.filter((r) => r.isShell && r.alreadyImported === 0);
  console.log(`\n🎯 신규 shell channel 후보: ${newShells.length}개`);
  for (const r of newShells) {
    console.log(`\n  ${r.id}  ${r.title}`);
    console.log(`     구독 ${r.subs} · 영상 ${r.videoCount} · 평균 ${r.avgViews.toLocaleString()} 조회`);
    for (const t of r.sampleTitles) console.log(`     · ${t}`);
  }
  if (newShells.length > 0) {
    console.log(`\n💡 import:`);
    for (const r of newShells) {
      console.log(`   npx tsx scripts/import-shell-channel.ts ${r.id} ${brand}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
