/**
 * Auto-tracking runner. Iterates all active Watch entries and runs the
 * full collection pipeline for each. Designed to be invoked once a day
 * (e.g. by macOS launchd at 3am).
 *
 * For each ad-kind watch:
 *   1. Scrape ATC (paginated)
 *   2. Save ads to DB
 *   3. Visit each ad detail page → extract YouTube IDs + preview images
 *   4. Fetch YouTube stats for matched videos
 *   5. Append AdStat snapshot for today
 *   6. Update Watch.lastRunAt + lastRunStatus + lastRunNote
 *
 * For each youtube-kind watch:
 *   1. Search YouTube via Data API
 *   2. Save Video rows
 *
 * Usage: npx tsx scripts/run-tracked.ts
 */
// Load env vars (Next.js handles .env.local automatically, but for our
// standalone script we need to load it ourselves).
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { prisma } from "../src/lib/db";
import { scrapeAds, isBotChallenge } from "../src/lib/atc-scraper";
import { extractAdInfoDirect } from "../src/lib/yt-extractor-direct";
import { fetchYouTubeStats } from "../src/lib/youtube-stats";
import { notifySlack, jobOutcomeMessage } from "../src/lib/slack";
import { checkProxyBalance } from "./proxy-balance";
import {
  denseCollectWeb,
  searchByPageIdWeb,
} from "../src/lib/meta-scraper-web";

// Sleep between back-to-back ATC scrapes in the daily batch. Without
// this, 5 watches × 50 pages run shoulder-to-shoulder and trip the
// /sorry/ bot challenge.
const BATCH_JOB_SLEEP_MS = 10_000;
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function listChannelUploads(channelId: string): Promise<string[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY missing");
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

async function runShellChannel(sc: {
  id: string;
  channelId: string;
  channelTitle: string;
  brandKeyword: string;
  region: string;
  titleFilter: string | null;
}) {
  const { channelId, channelTitle, brandKeyword, region, titleFilter } = sc;
  log(`▶ shell channel: "${channelTitle}" (${channelId}) → ${brandKeyword}`);
  const t0 = Date.now();

  try {
    const videoIds = await listChannelUploads(channelId);
    log(`  📹 채널 영상 ${videoIds.length}개`);

    const allStats = await fetchYouTubeStats(videoIds);
    const filterRe = titleFilter ? new RegExp(titleFilter, "i") : null;
    const stats = filterRe
      ? allStats.filter((s) => filterRe.test(s.title))
      : allStats;
    if (filterRe) {
      log(`  🔍 title 필터 매칭: ${stats.length}/${allStats.length}`);
    }

    const today = new Date().toISOString().slice(0, 10);
    const advertiserId = `shell:${channelId}`;
    let created = 0;
    let updated = 0;

    for (const s of stats) {
      const creativeId = `yt:${s.id}`;
      const existing = await prisma.ad.findUnique({ where: { creativeId } });
      await prisma.ad.upsert({
        where: { creativeId },
        create: {
          advertiserId,
          advertiserName: channelTitle,
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

    const note = `신규 ${created} / 갱신 ${updated} (필터 ${stats.length}/${allStats.length})`;
    await prisma.shellChannel.update({
      where: { id: sc.id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: "완료",
        lastRunNote: note,
      },
    });
    log(`  ✅ ${note}`);
    if (created > 0) {
      // Quiet on no-op refreshes; notify only when new ad creatives land.
      await notifySlack(
        jobOutcomeMessage({
          kind: "shell-channel",
          target: `${channelTitle} → ${brandKeyword}`,
          ok: true,
          note,
          durationSec: Math.round((Date.now() - t0) / 1000),
        })
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    await prisma.shellChannel.update({
      where: { id: sc.id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: "실패",
        lastRunNote: msg.slice(0, 200),
      },
    });
    log(`  ❌ 실패: ${msg}`);
    await notifySlack(
      jobOutcomeMessage({
        kind: "shell-channel",
        target: `${channelTitle} → ${brandKeyword}`,
        ok: false,
        note: msg.slice(0, 120),
        durationSec: Math.round((Date.now() - t0) / 1000),
      })
    );
  }
}

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
function log(msg: string) {
  console.log(`[${ts()}] ${msg}`);
}

async function runAdWatch(watch: {
  id: string;
  keyword: string;
  region: string;
}) {
  const { keyword, region } = watch;
  log(`▶ ad watch: "${keyword}" (region=${region})`);
  const t0 = Date.now();

  const job = await prisma.job.create({
    data: { keyword, status: "진행 중", kind: "ad" },
  });

  try {
    log(`  📡 ATC paginated fetch...`);
    // 트래픽 절감 (2026-07-21): 대형 brand(brand-g 11k·brand-a 9.7k 등)를
    // 매일 maxPages=200(8000개) 풀 수집하면 IPRoyal 트래픽 폭탄(1.5GB/일).
    // 핵심: cron 재수집 목적 = 신규 광고 잡기. 오래된 광고는 첫 수집 때 이미
    // DB 에 있음. ATC 는 최신순이라 신규는 앞 페이지 → 재수집은 앞부분만.
    //  - 첫 수집(기존 광고 <500) = 200페이지(누락 0, brand-h/brand-d 보호)
    //  - 재수집(기존 광고 500+) = 80페이지(3200개, 신규 다 잡고 트래픽 60%↓)
    const existingCount = await prisma.ad.count({ where: { keyword } });
    const isRecollect = existingCount >= 500;
    const maxPages = isRecollect ? 80 : 200;
    if (isRecollect)
      log(`  ♻️ 재수집 모드 (기존 ${existingCount}개) — maxPages ${maxPages}`);
    const result = await scrapeAds(keyword, {
      region,
      mode: "auto",
      maxPages,
      pageSize: 40,
      onPage: (i, total) => log(`     page ${i}: total ${total}`),
    });
    log(`  📢 광고 ${result.ads.length}개 발견`);

    // Persist ads
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
            keyword,
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
            keyword,
            jobId: job.id,
          },
        })
      )
    );

    // YouTube + ad-text extraction (all video/other candidates, recency-sorted)
    const candidates = [...result.ads]
      .filter(
        (a) => (a.type === "video" || a.type === "other") && a.previewUrl
      )
      .sort((a, b) => {
        const la = parseInt(a.lastSeen ?? "0", 10);
        const lb = parseInt(b.lastSeen ?? "0", 10);
        return lb - la;
      })
      .map((a) => ({
        advertiserId: a.advertiserId,
        creativeId: a.creativeId,
        previewUrl: a.previewUrl,
      }));

    let ytEnriched = 0;
    if (candidates.length > 0) {
      log(
        `  🎬 광고 정보 추출 (${candidates.length}개, content.js 직접 파싱)...`
      );
      const adInfoMap = await extractAdInfoDirect(candidates, {
        concurrency: 8,
      });

      // Persist all extracted info: yt id, image, headlines, description
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

      const ytPairs = Array.from(adInfoMap.entries()).filter(
        ([, v]) => v.youtubeId
      );
      if (ytPairs.length > 0) {
        const uniqueYtIds = Array.from(
          new Set(ytPairs.map(([, v]) => v.youtubeId!))
        );
        log(
          `  📊 YouTube 통계 수집 (${uniqueYtIds.length}개 고유 영상)...`
        );
        const stats = await fetchYouTubeStats(uniqueYtIds);
        const statsMap = new Map(stats.map((s) => [s.id, s]));

        const today = new Date().toISOString().slice(0, 10);
        await Promise.all(
          ytPairs.map(async ([creativeId, info]) => {
            const s = statsMap.get(info.youtubeId!);
            await prisma.ad.update({
              where: { creativeId },
              data: {
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
        log(`  📈 시계열 스냅샷 ${ytEnriched}개 저장 (${today})`);
      }
    }

    await prisma.job.update({
      where: { id: job.id },
      data: { status: "완료", adCount: result.ads.length, resultCount: ytEnriched },
    });
    const note = `광고 ${result.ads.length}개, YouTube ${ytEnriched}개`;
    await prisma.watch.update({
      where: { id: watch.id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: "완료",
        lastRunNote: note,
      },
    });
    log(`  ✅ 완료: ${note}`);
    await notifySlack(
      jobOutcomeMessage({
        kind: "ad-watch",
        target: keyword,
        ok: true,
        note,
        durationSec: Math.round((Date.now() - t0) / 1000),
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "실패", errorMsg: msg },
    });
    await prisma.watch.update({
      where: { id: watch.id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: "실패",
        lastRunNote: msg.slice(0, 200),
      },
    });
    log(`  ❌ 실패: ${msg}`);
    await notifySlack(
      jobOutcomeMessage({
        kind: "ad-watch",
        target: keyword,
        ok: false,
        note: msg.slice(0, 120),
        durationSec: Math.round((Date.now() - t0) / 1000),
      })
    );
  }
}

async function runAllWatches(
  watches: Array<{
    id: string;
    keyword: string;
    kind: string;
    region: string;
  }>
): Promise<{ aborted: boolean }> {
  for (let i = 0; i < watches.length; i++) {
    const w = watches[i];
    if (w.kind === "ad") {
      try {
        await runAdWatch(w);
      } catch (e) {
        // runAdWatch already swallows + records its own errors; this
        // catch is defensive only.
        if (isBotChallenge(e)) {
          log(`  🛑 bot challenge — aborting remaining ${watches.length - i - 1} watches`);
          return { aborted: true };
        }
      }
      // After-the-fact bot-challenge check: runAdWatch records the
      // error in lastRunNote/Job, so re-read the row to decide whether
      // to keep going.
      const fresh = await prisma.watch.findUnique({ where: { id: w.id } });
      if (fresh?.lastRunNote && /sorry|bot challenge|302/i.test(fresh.lastRunNote)) {
        log(`  🛑 watch "${w.keyword}" hit bot challenge — aborting batch`);
        await notifySlack(
          `🛑 *batch aborted* at "${w.keyword}" — ATC sent /sorry/ (bot challenge). ${watches.length - i - 1} remaining watches skipped; will retry tomorrow.`
        );
        return { aborted: true };
      }
      // Cooldown between successive ATC scrapes.
      if (i < watches.length - 1) await sleep(BATCH_JOB_SLEEP_MS);
    } else {
      log(`▶ youtube watch "${w.keyword}" — skipped (not implemented yet)`);
      await prisma.watch.update({
        where: { id: w.id },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: "완료",
          lastRunNote: "youtube watch — skipped",
        },
      });
    }
  }
  return { aborted: false };
}

/**
 * Distributed-cron mode: pick the single oldest job (across both
 * ad-watches and shell-channels) and run only that one. The launchd
 * plist is configured to call us every 10 minutes — this turns the
 * scheduler into a fair-queue worker that spreads ATC load instead
 * of hammering Google with all 9 jobs in a single 5-minute burst.
 */
async function runNextDue() {
  const watches = await prisma.watch.findMany({ where: { active: true } });
  const shells = await prisma.shellChannel.findMany({
    where: { active: true },
  });

  type Job =
    | { kind: "watch"; lastRunAt: Date | null; row: (typeof watches)[number] }
    | {
        kind: "shell";
        lastRunAt: Date | null;
        row: (typeof shells)[number];
      };

  const queue: Job[] = [
    ...watches.map((w) => ({
      kind: "watch" as const,
      lastRunAt: w.lastRunAt,
      row: w,
    })),
    ...shells.map((s) => ({
      kind: "shell" as const,
      lastRunAt: s.lastRunAt,
      row: s,
    })),
  ];
  if (queue.length === 0) {
    log("No active jobs.");
    return;
  }

  // Oldest first; never-run jobs (lastRunAt null) take priority.
  queue.sort((a, b) => {
    const ta = a.lastRunAt?.getTime() ?? 0;
    const tb = b.lastRunAt?.getTime() ?? 0;
    return ta - tb;
  });
  const next = queue[0];
  const lastTxt = next.lastRunAt
    ? next.lastRunAt.toISOString().slice(0, 19)
    : "never";
  log(`Picked next-due job: ${next.kind} (last run: ${lastTxt})`);

  if (next.kind === "watch") {
    await runAllWatches([next.row]);
  } else {
    await runShellChannel(next.row);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));

  // IPRoyal 잔여 트래픽 체크 + 알림 (수집 전에 먼저 — 소진이면 곧바로
  // 경고가 가도록). 토큰 미설정이면 조용히 스킵. 실패해도 수집은 진행.
  await checkProxyBalance().catch((e) =>
    log(`  proxy-balance 체크 실패(무시): ${(e as Error).message}`)
  );

  if (args.has("--next") || args.has("--next-due")) {
    await runNextDue();
    log("Done.");
    return;
  }

  // Default: run everything (used for one-off bulk runs / first install).
  // 격일 티어 필터 (2026-05-21): daily=true 는 매일, daily=false(기본)는
  // 마지막 실행 후 40시간+ 지났을 때만 (= 사실상 격일). cron 이 매일
  // 새벽 3시 도므로 격일 watch 는 24h(<40h, skip) → 48h(>40h, run) 패턴.
  // IPRoyal 트래픽을 절반으로 줄여 소진/cron 전멸을 방지한다.
  const DUE_MS = 40 * 3600 * 1000;
  const allActive = await prisma.watch.findMany({ where: { active: true } });
  const now = Date.now();
  const watches = allActive.filter((w) => {
    if (w.daily) return true; // 매일 티어
    if (!w.lastRunAt) return true; // 한 번도 안 돌았으면 실행
    return now - new Date(w.lastRunAt).getTime() >= DUE_MS; // 격일
  });
  log(
    `Found ${allActive.length} active watch(es), ${watches.length} due this run ` +
      `(${allActive.filter((w) => w.daily).length} daily, ${
        watches.length - allActive.filter((w) => w.daily).length
      } biweekly-due)`
  );
  const { aborted } = await runAllWatches(watches);

  if (aborted) {
    log("Skipping shell channels — ATC bot challenge in effect, will retry tomorrow.");
    log("Done (partial).");
    return;
  }

  // Shell channels only call YouTube Data API, not ATC, so even if ATC
  // is rate-limited these can keep running without trouble.
  const shells = await prisma.shellChannel.findMany({
    where: { active: true },
  });
  log(`Found ${shells.length} active shell channel(s)`);
  for (const sc of shells) {
    await runShellChannel(sc);
  }

  // Meta Ad Library — 자동 cron 비활성화 (사용자 결정 2026-05-21: 수동 전용).
  // 메타는 IPRoyal 프록시에 100% 의존하는데, 트래픽이 소진되면 매일 cron
  // 이 ERR_TUNNEL_CONNECTION_FAILED 로 전멸하며 실패 로그만 누적된다
  // (24h 동안 113건 실패 관측). 자동 실행을 끄고 사이드바 🔄 버튼으로
  // 수동 수집만 한다. 재개하려면 META_CRON_ENABLED=true 환경변수 설정.
  if (process.env.META_CRON_ENABLED === "true") {
    const metaWatches = await prisma.metaWatch.findMany({
      where: { active: true },
    });
    log(`Found ${metaWatches.length} active meta watch(es)`);
    for (const mw of metaWatches) {
      await runMetaWatch(mw);
    }
  } else {
    log("Meta cron 비활성화 (수동 전용). 재개: META_CRON_ENABLED=true");
  }

  log("Done.");
}

/**
 * Run one MetaWatch entry. Mirrors run-shells-only's pattern but for
 * the Meta scraper. Treats `page:<id>` keywords as a page-scoped scoop.
 */
async function runMetaWatch(mw: {
  id: string;
  keyword: string;
  region: string;
}) {
  log(`▶ meta watch: "${mw.keyword}" (region=${mw.region})`);
  const t0 = Date.now();

  const job = await prisma.metaJob.create({
    data: {
      keyword: mw.keyword,
      region: mw.region,
      status: "in_progress",
    },
  });

  try {
    const ads = mw.keyword.startsWith("page:")
      ? await searchByPageIdWeb(mw.keyword.slice(5), {
          maxScrolls: 30,
          onLog: (l) => log(`  ${l}`),
        })
      : (
          await denseCollectWeb(mw.keyword, {
            maxScrolls: 30,
            onLog: (l) => log(`  ${l}`),
          })
        ).ads;

    let upserted = 0;
    for (const a of ads) {
      await prisma.metaAd.upsert({
        where: { adArchiveId: a.adArchiveId },
        create: {
          adArchiveId: a.adArchiveId,
          pageId: a.pageId,
          pageName: a.pageName,
          bodies: JSON.stringify(a.bodies),
          linkTitles: JSON.stringify(a.linkTitles),
          linkDescriptions: JSON.stringify(a.linkDescriptions),
          linkCaptions: JSON.stringify(a.linkCaptions),
          snapshotUrl: a.snapshotUrl,
          startTime: a.startTime,
          stopTime: a.stopTime,
          languages: JSON.stringify(a.languages),
          publisherPlatforms: JSON.stringify(a.publisherPlatforms),
          mediaUrl: a.mediaUrl ?? null,
          mediaType: a.mediaType ?? null,
          avatarUrl: a.avatarUrl ?? null,
          lpUrl: a.lpUrl ?? null,
          lpDomain: a.lpDomain ?? null,
          utmCampaign: a.utmCampaign ?? null,
          utmTerm: a.utmTerm ?? null,
          utmContent: a.utmContent ?? null,
          region: mw.region,
          keyword: mw.keyword,
          jobId: job.id,
        },
        update: {
          pageName: a.pageName,
          bodies: JSON.stringify(a.bodies),
          mediaUrl: a.mediaUrl ?? null,
          mediaType: a.mediaType ?? null,
          avatarUrl: a.avatarUrl ?? null,
          lpUrl: a.lpUrl ?? null,
          lpDomain: a.lpDomain ?? null,
          utmCampaign: a.utmCampaign ?? null,
          utmTerm: a.utmTerm ?? null,
          utmContent: a.utmContent ?? null,
          jobId: job.id,
        },
      });
      upserted++;
    }

    await prisma.metaJob.update({
      where: { id: job.id },
      data: {
        status: "complete",
        adCount: ads.length,
        pageCount: new Set(ads.map((a) => a.pageId).filter(Boolean)).size,
      },
    });
    const note = `광고 ${upserted}개 (${Math.round(
      (Date.now() - t0) / 1000
    )}s)`;
    await prisma.metaWatch.update({
      where: { id: mw.id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: "완료",
        lastRunNote: note,
      },
    });
    log(`  ✅ ${note}`);
    if (upserted > 0) {
      await notifySlack(
        jobOutcomeMessage({
          kind: "shell-channel",
          target: `meta:${mw.keyword}`,
          ok: true,
          note,
          durationSec: Math.round((Date.now() - t0) / 1000),
        })
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    await prisma.metaJob.update({
      where: { id: job.id },
      data: { status: "error", errorMsg: msg.slice(0, 500) },
    });
    await prisma.metaWatch.update({
      where: { id: mw.id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: "실패",
        lastRunNote: msg.slice(0, 200),
      },
    });
    log(`  ❌ 실패: ${msg}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
