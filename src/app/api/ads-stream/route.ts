import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  scrapeAds,
  looksLikeDomain,
  normalizeDomain,
  type SearchMode,
} from "@/lib/atc-scraper";
import { extractAdInfoDirect } from "@/lib/yt-extractor-direct";
import { fetchYouTubeStats } from "@/lib/youtube-stats";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * SSE endpoint that streams real-time collection progress.
 * GET /api/ads-stream?query=example-shop.com&region=KR
 *
 * Events:
 *   - log:     {msg, level: 'info'|'success'|'warn'|'error'}
 *   - progress: {step, done, total, percent}
 *   - done:    {ads, ytEnriched, jobId}
 *   - error:   {message}
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rawQuery = url.searchParams.get("query")?.trim();
  if (!rawQuery) {
    return new Response("query required", { status: 400 });
  }
  // 도메인으로 보이면 정규화해서 keyword 로 쓴다. 스크래퍼 자체는 URL 을
  // 알아서 벗겨내지만, 정규화 전 문자열을 그대로 Job/Watch/Ad.keyword 에
  // 저장하면 "https://example.com/" 과 "example.com" 이 서로 다른 키워드가
  // 돼서 사이드바에 중복 브랜드가 생기고 광고가 둘로 쪼개진다.
  const query = looksLikeDomain(rawQuery)
    ? normalizeDomain(rawQuery)
    : rawQuery;
  const region = url.searchParams.get("region") ?? "KR";
  const mode = (url.searchParams.get("mode") ?? "auto") as SearchMode;
  const enrichYoutube =
    url.searchParams.get("enrichYoutube") !== "false";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      };
      const log = (msg: string, level: "info" | "success" | "warn" | "error" = "info") =>
        send("log", { msg, level });
      const progress = (
        step: string,
        done: number,
        total: number
      ) =>
        send("progress", {
          step,
          done,
          total,
          percent: total > 0 ? Math.floor((done / total) * 100) : 0,
        });

      const job = await prisma.job.create({
        data: { keyword: query, status: "진행 중", kind: "ad" },
      });
      send("job", { id: job.id, keyword: query });

      // Watch 자동 복구 — 이유 미상으로 Watch row 가 사라지는 이슈 (2026-07-08
      // 발견, 122개 복구). Job 생성마다 Watch 도 upsert 하면 사이드바에서
      // 사라져도 다음 검색 때 자동 복구. active=true 로 살아있는 상태 유지.
      // 예외: snapshot=1 (1회 스냅샷 모드) 은 Watch 안 만듦 = cron 미편입.
      // 신규 brand 발굴처럼 "한 번만 조사" 할 때 트래픽 절약 (레퍼런스 도구 벤치마크).
      const isSnapshot = url.searchParams.get("snapshot") === "1";
      if (!isSnapshot) {
        await prisma.watch
          .upsert({
            where: {
              keyword_kind_region: { keyword: query, kind: "ad", region },
            },
            create: { keyword: query, kind: "ad", region, active: true },
            update: { active: true },
          })
          .catch(() => {});
      }

      try {
        log(`🔍 검색 시작: "${query}"`);
        progress("starting", 0, 100);

        // 1) ATC SearchSuggestions / SearchCreatives (paginated)
        log("📡 Google Ads Transparency Center 호출 중...");
        progress("atc", 5, 100);
        const result = await scrapeAds(query, {
          region,
          mode,
          topAdvertisers: 5,
          pageSize: 40,
          // 핵심 본질: brand 의 광고를 누락없이 다 가져옴. cap 200 = 8000개
          // 한 brand 면 충분 (brand-d 3000 / example-shop ~50 / 대부분 < 1000).
          // ATC 가 cursor 안 주면 paginateCreatives 의 자연 종료로 빨리 끝남.
          // 이전엔 25 (=1000개) cap 으로 brand-d 같은 큰 brand 1/3 누락.
          maxPages: 200,
          onPage: (pageIdx, total) => {
            log(`   📄 page ${pageIdx} 수집: 누적 ${total}개`);
            // ATC 스크래핑이 실제로 검색 시간의 60~70%를 차지함.
            // 5~60% 범위로 페이지 진행을 더 정확히 반영.
            const pct = Math.min(5 + pageIdx * 2.2, 60);
            progress("atc", Math.floor(pct), 100);
          },
        });
        if (result.ads.length === 0) {
          log(`📢 광고 0개 — ATC에 이 검색에 대한 데이터가 없어요`, "warn");
          log(
            `   ↳ 가능한 이유: ① 이 회사가 Google 광고를 안 돌림 (네이버/카카오만 씀) ② 다른 지역에서만 송출 ③ ATC 미인덱싱`,
            "warn"
          );
          if (result.domain) {
            log(
              `   ↳ ATC에서 직접 확인: https://adstransparency.google.com/?region=${region}&domain=${result.domain}`
            );
          }
        } else {
          log(
            `📢 광고 ${result.ads.length}개 발견 (mode=${result.mode}${
              result.domain ? ", domain=" + result.domain : ""
            })`,
            "success"
          );
          log(
            `   광고주: ${result.advertisers
              .slice(0, 3)
              .map((a) => a.name)
              .join(", ")}${result.advertisers.length > 3 ? "..." : ""}`
          );
        }
        progress("atc", 60, 100);

        // 2) Save initial ads
        log("💾 DB 저장 중...");
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
        const types = result.ads.reduce<Record<string, number>>((m, a) => {
          m[a.type] = (m[a.type] ?? 0) + 1;
          return m;
        }, {});
        log(
          `   유형별: 이미지 ${types.image ?? 0} · 영상 ${
            types.video ?? 0
          } · 기타 ${types.other ?? 0}`
        );
        progress("save", 65, 100);

        // 3) YouTube ID extraction
        let ytEnriched = 0;
        if (enrichYoutube) {
          const candidates = result.ads
            .filter((a) => a.type === "video" || a.type === "other")
            .map((a) => ({
              advertiserId: a.advertiserId,
              creativeId: a.creativeId,
            }));

          if (candidates.length === 0) {
            log("ℹ️ 영상/기타 광고가 없어 매칭 건너뜀");
          } else {
            // Direct HTTP fetching of content.js URLs. ~30x faster than
            // the old Playwright approach (no browser, no rate limits on
            // detail-page navigation). Also extracts ad headline/desc text.
            const sortedByRecency = [...result.ads]
              .filter(
                (a) =>
                  (a.type === "video" || a.type === "other") && a.previewUrl
              )
              .sort((a, b) => {
                const la = parseInt(a.lastSeen ?? "0", 10);
                const lb = parseInt(b.lastSeen ?? "0", 10);
                return lb - la;
              });
            const ytCandidates = sortedByRecency.map((a) => ({
              advertiserId: a.advertiserId,
              creativeId: a.creativeId,
              previewUrl: a.previewUrl,
            }));
            const estSec = Math.ceil((ytCandidates.length * 0.3) / 8);
            log(
              `🎬 광고 정보 추출 시작 (${ytCandidates.length}개, content.js 직접 파싱, 동시 8개, 예상 ~${estSec}초)`
            );

            const adInfoMap = await extractAdInfoDirect(ytCandidates, {
              concurrency: 8,
              onProgress: (done, total, ytF, imgF) => {
                // yt-extract takes ~20% of total time (content.js fetch x N).
                // Range: 65 → 88.
                progress(
                  "yt-extract",
                  65 + Math.floor((done / total) * 23),
                  100
                );
                if (done % 10 === 0 || done === total) {
                  log(
                    `   [${done}/${total}] 진행 중... YouTube ${ytF}개 · 미리보기 ${imgF}개`
                  );
                }
              },
            });

            const ytPairs = Array.from(adInfoMap.entries()).filter(
              ([, v]) => v.youtubeId
            );
            const imagePairs = Array.from(adInfoMap.entries()).filter(
              ([, v]) => v.previewImage
            );
            const textPairs = Array.from(adInfoMap.entries()).filter(
              ([, v]) => v.adHeadline || v.adLongHeadline || v.adDescription
            );
            log(
              `🎬 매칭: YouTube ${ytPairs.length} · 🖼️ 미리보기 ${imagePairs.length} · 📝 광고 텍스트 ${textPairs.length} (전체 ${ytCandidates.length})`,
              "success"
            );
            progress("yt-extract", 88, 100);

            // Save ALL extracted info per ad (yt id, image, headlines, desc)
            await Promise.all(
              Array.from(adInfoMap.entries()).map(([creativeId, info]) =>
                prisma.ad.update({
                  where: { creativeId },
                  data: {
                    youtubeId: info.youtubeId,
                    previewImage: info.previewImage,
                    adHeadline: info.adHeadline,
                    adLongHeadline: info.adLongHeadline,
                    adDescription: info.adDescription,
                  },
                })
              )
            );

            // Then fetch + save YouTube stats for matched videos
            if (ytPairs.length > 0) {
              const uniqueYtIds = Array.from(
                new Set(ytPairs.map(([, v]) => v.youtubeId!))
              );
              log(
                `📊 YouTube 통계 수집 중 (${uniqueYtIds.length}개 고유 영상)...`
              );
              const stats = await fetchYouTubeStats(uniqueYtIds);
              const statsMap = new Map(stats.map((s) => [s.id, s]));
              log(
                `📊 통계 수집 완료: 성공 ${stats.length}/${uniqueYtIds.length}`,
                "success"
              );
              progress("yt-stats", 90, 100);

              const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
              await Promise.all(
                ytPairs.map(async ([creativeId, info]) => {
                  const s = statsMap.get(info.youtubeId!);
                  // YouTube description을 adDescription 으로 저장 — ATC 가
                  // 카피 텍스트 안 노출하므로 영상 광고는 description 이 가장
                  // 가까운 카피. content.js 파싱이 이미 adDescription 채웠으면
                  // 그게 ATC 직접 카피라 우선.
                  const ytDesc = s?.description?.trim() || null;
                  const adData: {
                    ytTitle: string | null;
                    ytChannel: string | null;
                    ytPublishedAt: string | null;
                    ytViews: number | null;
                    ytLikes: number | null;
                    ytComments: number | null;
                    ytDurationSec: number | null;
                    ytFetchedAt: Date;
                    adDescription?: string;
                  } = {
                    ytTitle: s?.title ?? null,
                    ytChannel: s?.channel ?? null,
                    ytPublishedAt: s?.publishedAt ?? null,
                    ytViews: s?.views ?? null,
                    ytLikes: s?.likes ?? null,
                    ytComments: s?.comments ?? null,
                    ytDurationSec: s?.durationSec ?? null,
                    ytFetchedAt: new Date(),
                  };
                  // ATC adDescription 이 비었을 때만 YouTube description 으로 채움.
                  const existing = await prisma.ad.findUnique({
                    where: { creativeId },
                    select: { adDescription: true },
                  });
                  if (!existing?.adDescription && ytDesc) {
                    adData.adDescription = ytDesc;
                  }
                  await prisma.ad.update({
                    where: { creativeId },
                    data: adData,
                  });
                  // Append a time-series snapshot for today (one row per ad
                  // per day; multiple searches in the same day overwrite).
                  if (s) {
                    await prisma.adStat.upsert({
                      where: {
                        creativeId_capturedDate: {
                          creativeId,
                          capturedDate: today,
                        },
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
                })
              );
              ytEnriched = ytPairs.length;
              log(`📈 시계열 스냅샷 저장: ${ytPairs.length}개 (${today})`);
            }
          }
        }

        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: "완료",
            adCount: result.ads.length,
            resultCount: ytEnriched,
          },
        });
        progress("done", 100, 100);
        log(
          `✅ 완료! 총 ${result.ads.length}개 광고, ${ytEnriched}개 YouTube 영상 매칭`,
          "success"
        );
        send("done", {
          jobId: job.id,
          ads: result.ads.length,
          ytEnriched,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "알 수 없는 오류";
        log(`❌ 실패: ${msg}`, "error");
        await prisma.job
          .update({
            where: { id: job.id },
            data: { status: "실패", errorMsg: msg },
          })
          .catch(() => {});
        send("error", { message: msg });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
