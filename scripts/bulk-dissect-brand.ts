/**
 * One-shot pipeline: dissect example.co.kr's Top N most-viewed shell-channel
 * ads, run Claude Vision enrichment on each, then mine copy patterns.
 *
 * Talks only to our own /api endpoints — the in-process worker queue
 * serializes all dissection jobs so we won't fight ATC / yt-dlp / Whisper
 * rate limits.
 *
 * Usage:
 *   npx tsx scripts/bulk-dissect-brand.ts          # default Top 10
 *   npx tsx scripts/bulk-dissect-brand.ts 20       # custom N
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { prisma } from "../src/lib/db";

const HOST = process.env.AD_COLLECTOR_HOST || "http://localhost:3000";
const TOP_N = parseInt(process.argv[2] || "10", 10);
const CHANNEL_ID = "UCoAX4FxNQSbylQseyzfboYw"; // 쪼잘쪼잘 jjojaljjojal
const BRAND = "example.co.kr";

function ts() {
  return new Date().toISOString().slice(11, 19);
}
function log(msg: string) {
  console.log(`[${ts()}] ${msg}`);
}

async function pickTopAds(): Promise<
  Array<{ youtubeId: string; creativeId: string; views: number; title: string }>
> {
  const rows = await prisma.ad.findMany({
    where: {
      keyword: BRAND,
      advertiserId: `shell:${CHANNEL_ID}`,
      ytViews: { not: null },
      youtubeId: { not: null },
    },
    orderBy: { ytViews: "desc" },
    take: TOP_N,
    select: {
      youtubeId: true,
      creativeId: true,
      ytViews: true,
      ytTitle: true,
    },
  });
  return rows.map((r) => ({
    youtubeId: r.youtubeId!,
    creativeId: r.creativeId,
    views: r.ytViews || 0,
    title: r.ytTitle || "(제목 없음)",
  }));
}

async function enqueue(youtubeId: string, creativeId: string): Promise<{
  id: string;
  reused: boolean;
}> {
  const res = await fetch(`${HOST}/api/dissect/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `https://www.youtube.com/watch?v=${youtubeId}`,
      adCreativeId: creativeId,
    }),
  });
  if (!res.ok) {
    throw new Error(`enqueue ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<{ id: string; reused: boolean }>;
}

async function getStatus(
  id: string
): Promise<{ status: string; rowCount: number; error: string | null }> {
  const res = await fetch(`${HOST}/api/dissect/${id}`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const j = (await res.json()) as {
    status: string;
    rows?: unknown[];
    error?: string;
  };
  return {
    status: j.status,
    rowCount: j.rows?.length ?? 0,
    error: j.error ?? null,
  };
}

async function waitAllComplete(ids: string[]): Promise<void> {
  const seen = new Set<string>();
  while (seen.size < ids.length) {
    await new Promise((r) => setTimeout(r, 8000));
    for (const id of ids) {
      if (seen.has(id)) continue;
      const s = await getStatus(id);
      if (s.status === "complete" || s.status === "error") {
        log(
          `  [${seen.size + 1}/${ids.length}] ${id.slice(0, 12)}… → ${s.status}${
            s.status === "complete" ? ` (${s.rowCount} rows)` : ` ${s.error?.slice(0, 80)}`
          }`
        );
        seen.add(id);
      }
    }
  }
}

async function enrich(id: string): Promise<{
  visibleTextFilled: number;
  categoryFilled: number;
}> {
  const res = await fetch(`${HOST}/api/dissect/${id}/enrich`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`enrich ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<{
    visibleTextFilled: number;
    categoryFilled: number;
  }>;
}

async function minePatterns() {
  const res = await fetch(`${HOST}/api/copy-patterns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brandKeyword: BRAND }),
  });
  if (!res.ok) {
    throw new Error(
      `copy-patterns ${res.status}: ${(await res.text()).slice(0, 300)}`
    );
  }
  return res.json();
}

async function main() {
  log(`▶ Bulk dissect: ${BRAND} Top ${TOP_N} (channel ${CHANNEL_ID})`);
  const top = await pickTopAds();
  log(`Selected ${top.length} ads (views ${top[0]?.views.toLocaleString()} → ${top.at(-1)?.views.toLocaleString()}):`);
  for (const a of top) log(`  · ${a.youtubeId} (${a.views.toLocaleString()}) ${a.title.slice(0, 50)}`);

  log("");
  log(`▶ Stage 1/3: Enqueueing ${top.length} dissection jobs…`);
  const jobs: Array<{ youtubeId: string; dissectionId: string; reused: boolean }> = [];
  for (const a of top) {
    const r = await enqueue(a.youtubeId, a.creativeId);
    jobs.push({ youtubeId: a.youtubeId, dissectionId: r.id, reused: r.reused });
    log(`  ${a.youtubeId} → ${r.id.slice(0, 12)}… ${r.reused ? "(reused)" : "(new)"}`);
  }

  log("");
  log(`▶ Stage 2a/3: Waiting for all dissections to complete (yt-dlp + scenes + Whisper)…`);
  await waitAllComplete(jobs.map((j) => j.dissectionId));

  log("");
  log(`▶ Stage 2b/3: Claude Vision enrichment on each (화면자막 + 카테고리)…`);
  let visTotal = 0;
  let catTotal = 0;
  for (const j of jobs) {
    try {
      const r = await enrich(j.dissectionId);
      visTotal += r.visibleTextFilled;
      catTotal += r.categoryFilled;
      log(
        `  ${j.youtubeId} → visible+${r.visibleTextFilled}, category+${r.categoryFilled}`
      );
    } catch (e) {
      log(`  ${j.youtubeId} → enrich FAILED: ${(e as Error).message}`);
    }
  }
  log(`  TOTAL: visible+${visTotal}, category+${catTotal}`);

  log("");
  log(`▶ Stage 3/3: Mining copy patterns from ${jobs.length} dissected ads…`);
  const patterns = await minePatterns();
  log("");
  log(`========== EXAMPLE COPY PATTERNS ==========`);
  console.log(JSON.stringify(patterns, null, 2));
  log("============================================");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
