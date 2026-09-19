import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scrapeAds, type SearchMode } from "@/lib/atc-scraper";
import { extractYouTubeIdsForAds } from "@/lib/yt-extractor";
import { fetchYouTubeStats } from "@/lib/youtube-stats";
import { brotliCompressSync, gzipSync, constants as zlibConst } from "node:zlib";

/**
 * 응답을 gzip/brotli 로 직접 압축. Next.js 16의 `compress: true` 가
 * `next start` 환경에서 작동 안 함 (확인 완료) — API route에서 명시적
 * 처리. 4MB 광고 JSON → gzip ~600KB (한국→Singapore 다운로드 5초 → <1초).
 */
function compressedJson(
  body: unknown,
  acceptEncoding: string | null
): Response {
  const json = JSON.stringify(body);
  const ae = acceptEncoding ?? "";
  if (ae.includes("br")) {
    const buf = brotliCompressSync(Buffer.from(json), {
      // Quality 4 = 압축 시간/비율 균형. 11(max)은 너무 느림.
      params: { [zlibConst.BROTLI_PARAM_QUALITY]: 4 },
    });
    return new Response(buf, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "br",
        "Cache-Control": "no-store",
      },
    });
  }
  if (ae.includes("gzip")) {
    const buf = gzipSync(Buffer.from(json), { level: 6 });
    return new Response(buf, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "gzip",
        "Cache-Control": "no-store",
      },
    });
  }
  // 압축 미지원 클라이언트 — 그대로 반환 (드물지만 fallback).
  return NextResponse.json(body);
}

export const maxDuration = 120; // up to 2 minutes for YouTube extraction

export async function POST(req: NextRequest) {
  let body: {
    query?: string;
    keyword?: string; // backward-compat
    mode?: SearchMode;
    region?: string;
    topAdvertisers?: number;
    enrichYoutube?: boolean; // optional, default true
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const query = (body.query ?? body.keyword ?? "").trim();
  if (!query) {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }
  const region = body.region ?? "KR";
  const enrichYoutube = body.enrichYoutube ?? true;

  const job = await prisma.job.create({
    data: { keyword: query, status: "진행 중", kind: "ad" },
  });

  // Watch 자동 복구 — 2026-07-08 이슈: 원인 미상으로 Watch row 가 사라지는
  // 패턴 있어서 Job 만들 때 Watch upsert. 사이드바에서 사라져도 검색 시 복구.
  await prisma.watch
    .upsert({
      where: { keyword_kind_region: { keyword: query, kind: "ad", region } },
      create: { keyword: query, kind: "ad", region, active: true },
      update: { active: true },
    })
    .catch(() => {});

  try {
    // 1) Basic ATC scrape (fast, no browser)
    const result = await scrapeAds(query, {
      region,
      mode: body.mode ?? "auto",
      topAdvertisers: body.topAdvertisers ?? 5,
      pageSize: 40,
      // 본질: brand 광고 누락없이. cursor 끝까지. 큰 brand 면 ~200 페이지 = 8000.
      // 대부분 brand 는 cursor 일찍 끝나서 빨리 멈춤.
      maxPages: 200,
    });

    // 2) Save initial ads (without YouTube IDs yet)
    await Promise.all(
      result.ads.map((a) =>
        prisma.ad.upsert({
          where: { creativeId: a.creativeId },
          create: {
            advertiserId: a.advertiserId,
            advertiserName: a.advertiserName,
            creativeId: a.creativeId,
            type: a.type,
            region,
            firstSeen: a.firstSeen,
            lastSeen: a.lastSeen,
            previewUrl: a.previewUrl,
            imageHtml: a.imageHtml,
            obfuscatedCustomerId: a.obfuscatedCustomerId,
            keyword: query,
            via: a.via ?? null,
            jobId: job.id,
          },
          update: {
            advertiserName: a.advertiserName,
            type: a.type,
            firstSeen: a.firstSeen,
            lastSeen: a.lastSeen,
            previewUrl: a.previewUrl,
            imageHtml: a.imageHtml,
            obfuscatedCustomerId: a.obfuscatedCustomerId,
            keyword: query,
            via: a.via ?? null,
            jobId: job.id,
          },
        })
      )
    );

    // 3) YouTube ID extraction: visit each video ad's detail URL in parallel.
    // ATC ad types: 1=image (skip), 2=video, 3=other (often video too).
    let ytEnriched = 0;
    if (enrichYoutube) {
      try {
        const candidates = result.ads
          .filter((a) => a.type === "video" || a.type === "other")
          .map((a) => ({
            advertiserId: a.advertiserId,
            creativeId: a.creativeId,
          }));

        if (candidates.length > 0) {
          const adToYt = await extractYouTubeIdsForAds(candidates, {
            region,
            concurrency: 5,
            perAdTimeoutMs: 12000,
          });

          if (adToYt.size > 0) {
            // Fetch YouTube stats for all unique IDs in one batch
            const uniqueYtIds = Array.from(new Set(adToYt.values()));
            const stats = await fetchYouTubeStats(uniqueYtIds);
            const statsMap = new Map(stats.map((s) => [s.id, s]));

            // Save youtubeId + stats per ad
            await Promise.all(
              Array.from(adToYt.entries()).map(async ([creativeId, ytId]) => {
                const s = statsMap.get(ytId);
                await prisma.ad.update({
                  where: { creativeId },
                  data: {
                    youtubeId: ytId,
                    ytTitle: s?.title ?? null,
                    ytChannel: s?.channel ?? null,
                    ytPublishedAt: s?.publishedAt ?? null,
                    ytViews: s?.views ?? null,
                    ytLikes: s?.likes ?? null,
                    ytComments: s?.comments ?? null,
                    ytDurationSec: s?.durationSec ?? null,
                    ytFetchedAt: new Date(),
                  },
                });
              })
            );
            ytEnriched = adToYt.size;
          }
        }
      } catch (e) {
        console.error("YouTube enrichment failed:", e);
      }
    }

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: { status: "완료", adCount: result.ads.length, resultCount: ytEnriched },
    });

    return NextResponse.json({
      job: updated,
      mode: result.mode,
      domain: result.domain,
      advertisers: result.advertisers,
      ads: result.ads,
      ytEnriched,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "실패", errorMsg: msg },
    });
    return NextResponse.json({ error: msg, jobId: job.id }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  // 첫 응답 경량화 — `?withStats=false` 면 stats 빼고 본체만 반환.
  // page.tsx 의 첫 fetch 가 사용. 변화 컬럼은 별도 /api/ad-stats fetch
  // 로 lazy 채움. 12MB → ~2MB 로 줄어 첫 화면 5초 단축.
  const url = new URL(req.url);
  const withStats = url.searchParams.get("withStats") !== "false";
  // ?limit=N — 첫 진입 시 가벼운 응답용. 사용자가 keyword 클릭하면 server에
  // ?keyword=... 별도 fetch (가능할 시). 일단 200개만 보내면 8MB → 400KB.
  // ?keyword=foo — 그 keyword 의 광고만. 사이드바 brand 클릭 시 사용.
  const limit = Math.max(0, parseInt(url.searchParams.get("limit") ?? "0", 10)) || undefined;
  const keyword = url.searchParams.get("keyword") || undefined;

  // No artificial limit — multi-domain analysis was being truncated when
  // total ads exceeded a few hundred.
  //
  // ⚠️ Don't use Prisma's `include: { stats }` here. With 1000+ ads it
  // generates an IN(?, ?, ...) on every parent id, and SQLite's default
  // variable cap is hit (P2029). Instead we fetch stats in chunks and
  // join in JS — same shape, no limit.
  // previewUrl 은 server-side scrape 에만 쓰이고 UI 에서 안 쓰임 (atcLink
  // 는 advertiserId+creativeId 만 있으면 됨). 응답에서 빼면 광고당 평균
  // 800B 절약 → 4000개 ads 면 3MB. 첫 페이로드 가장 효과적인 다이어트.
  const ads = await prisma.ad.findMany({
    where: keyword ? { keyword } : undefined,
    orderBy: { savedAt: "desc" },
    take: limit ?? 10000,
    omit: { previewUrl: true },
  });

  if (!withStats) {
    // 본체만 — 변화 컬럼은 client 가 /api/ad-stats 로 lazy fetch.
    // Cache-Control: 30초 cache 로 사용자 새로고침 / 직원 다중 접속 시
    // SQLite 쿼리 + serialize 반복 회피. 새 검색 후 30초만 stale.
    const resp = compressedJson(
      { ads: ads.map((a) => ({ ...a, stats: [] })) },
      req.headers.get("accept-encoding")
    );
    const headers = new Headers(resp.headers);
    headers.set("Cache-Control", "private, max-age=30");
    return new Response(resp.body, { status: resp.status, headers });
  }

  const creativeIds = ads.map((a) => a.creativeId);
  type Stat = {
    creativeId: string;
    capturedDate: string;
    views: number;
    likes: number;
    comments: number;
  };
  const byCid = new Map<string, Stat[]>();

  // SQLite default SQLITE_MAX_VARIABLE_NUMBER is 32k on modern builds,
  // but Prisma also chunks. Stay well under any limit with 500/batch.
  // Also: only return the last 90 days of stats — analyzeDays maxes at 90,
  // so older snapshots only inflate the JSON payload (12.5MB → ~2MB).
  // Pages with longer analysis horizons can hit /api/ad-stats?creativeId=... later.
  const cutoffDate = new Date(Date.now() - 90 * 86400000)
    .toISOString()
    .slice(0, 10);
  const CHUNK = 500;
  for (let i = 0; i < creativeIds.length; i += CHUNK) {
    const chunk = creativeIds.slice(i, i + CHUNK);
    const stats = await prisma.adStat.findMany({
      where: {
        creativeId: { in: chunk },
        capturedDate: { gte: cutoffDate },
      },
      orderBy: { capturedDate: "asc" },
      select: {
        creativeId: true,
        capturedDate: true,
        views: true,
        likes: true,
        comments: true,
      },
    });
    for (const s of stats) {
      const arr = byCid.get(s.creativeId) ?? [];
      arr.push(s);
      byCid.set(s.creativeId, arr);
    }
  }

  const adsWithStats = ads.map((a) => ({
    ...a,
    stats: byCid.get(a.creativeId) ?? [],
  }));
  return compressedJson(
    { ads: adsWithStats },
    req.headers.get("accept-encoding")
  );
}

export async function DELETE(req: NextRequest) {
  // 관리자 전용 — 전체 광고 삭제는 되돌릴 수 없으므로 ADMIN_DELETE_SECRET
  // 헤더 검증. 페이지가 Cloudflare Access bypass(공개) 라 이 서버측 검증이
  // 유일한 방어선. secret 미설정 시에도 거부(안전 우선).
  const expected = process.env.ADMIN_DELETE_SECRET;
  const provided = req.headers.get("x-admin-secret");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }
  await prisma.ad.deleteMany();
  return NextResponse.json({ ok: true });
}
