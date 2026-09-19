import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Dashboard aggregator. Returns:
 *   - 5 KPIs (active, new, ended, accel, spike)
 *   - per-domain daily ad-count timeseries
 *   - top 10 view-count movers
 *   - newest ads (recent firstSeen)
 *
 * Query: ?days=1 | 7 | 30  (default 7)
 *
 * "Graceful degradation": when there aren't enough AdStat snapshots yet
 * to compute trend KPIs (가속도/스파이크), they return 0 + a flag so the
 * UI can gray them out and explain.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = Math.min(
    Math.max(parseInt(url.searchParams.get("days") ?? "7", 10), 1),
    90
  );
  const now = Date.now();
  const rangeStartUnix = Math.floor((now - days * 86400000) / 1000);
  const todayDate = new Date(now).toISOString().slice(0, 10);
  const rangeStartDate = new Date(now - days * 86400000)
    .toISOString()
    .slice(0, 10);

  // ── Pull everything we need in parallel ──────────────────────────────
  const [allAds, allStats, snapshotDates] = await Promise.all([
    prisma.ad.findMany({
      select: {
        id: true,
        creativeId: true,
        keyword: true,
        advertiserName: true,
        advertiserId: true,
        type: true,
        firstSeen: true,
        lastSeen: true,
        savedAt: true,
        youtubeId: true,
        ytTitle: true,
        ytViews: true,
        ytLikes: true,
        ytPublishedAt: true,
        adHeadline: true,
        adLongHeadline: true,
        adDescription: true,
        previewImage: true,
        imageHtml: true,
        region: true,
      },
      take: 10000,
    }),
    prisma.adStat.findMany({
      where: { capturedDate: { gte: rangeStartDate } },
      orderBy: { capturedDate: "asc" },
      select: {
        creativeId: true,
        capturedDate: true,
        views: true,
        likes: true,
      },
    }),
    prisma.adStat.findMany({
      distinct: ["capturedDate"],
      orderBy: { capturedDate: "desc" },
      select: { capturedDate: true },
      take: 30,
    }),
  ]);

  const distinctSnapshotDays = snapshotDates.map((s) => s.capturedDate);
  const haveTrendData = distinctSnapshotDays.length >= 2;

  // ── Stats by creativeId ──────────────────────────────────────────────
  type StatPoint = { date: string; views: number; likes: number };
  const statsByAd = new Map<string, StatPoint[]>();
  for (const s of allStats) {
    const arr = statsByAd.get(s.creativeId) ?? [];
    arr.push({
      date: s.capturedDate,
      views: s.views,
      likes: s.likes,
    });
    statsByAd.set(s.creativeId, arr);
  }

  // ── KPI: 활성 광고 ──────────────────────────────────────────────────
  // "Active" = ads whose lastSeen is within the last 'days' window
  // (i.e. ATC observed them recently). Falls back to "all" when lastSeen
  // is missing.
  const activeAds = allAds.filter((a) => {
    if (!a.lastSeen) return true; // unknown → assume active
    const ts = parseInt(a.lastSeen, 10);
    if (isNaN(ts)) return true;
    return ts >= rangeStartUnix;
  });

  // ── KPI: 신규 광고 (firstSeen within range) ─────────────────────────
  const newAds = allAds.filter((a) => {
    if (!a.firstSeen) return false;
    const ts = parseInt(a.firstSeen, 10);
    if (isNaN(ts)) return false;
    return ts >= rangeStartUnix;
  });

  // ── KPI: 종료 광고 (lastSeen before range start) ─────────────────────
  const endedAds = allAds.filter((a) => {
    if (!a.lastSeen) return false;
    const ts = parseInt(a.lastSeen, 10);
    if (isNaN(ts)) return false;
    return ts < rangeStartUnix;
  });

  // ── KPI: 가속도 / 스파이크 (need 2+ snapshots) ──────────────────────
  let accelTopCount = 0;
  let spikeCount = 0;
  if (haveTrendData) {
    for (const ad of allAds) {
      const stats = statsByAd.get(ad.creativeId);
      if (!stats || stats.length < 2) continue;
      const sorted = [...stats].sort((a, b) =>
        a.date.localeCompare(b.date)
      );
      const deltas: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        deltas.push(sorted[i].views - sorted[i - 1].views);
      }
      const last = deltas[deltas.length - 1];
      const prev = deltas[deltas.length - 2] ?? 0;

      // 스파이크: latest delta >= 200% of previous
      if (prev > 100 && last >= prev * 2) spikeCount++;

      // 가속도: recent avg > overall avg * 1.3
      if (deltas.length >= 3) {
        const recent = deltas.slice(-3).reduce((s, d) => s + d, 0) / 3;
        const overall = deltas.reduce((s, d) => s + d, 0) / deltas.length;
        if (recent > overall * 1.3 && recent > 1000) accelTopCount++;
      }
    }
  }

  // ── Per-domain daily ad-count timeseries ────────────────────────────
  // For each snapshot date, count distinct creativeIds per domain.
  const domainDayCounts = new Map<string, Map<string, Set<string>>>();
  for (const s of allStats) {
    const ad = allAds.find((a) => a.creativeId === s.creativeId);
    if (!ad) continue;
    let byDate = domainDayCounts.get(s.capturedDate);
    if (!byDate) {
      byDate = new Map();
      domainDayCounts.set(s.capturedDate, byDate);
    }
    let set = byDate.get(ad.keyword);
    if (!set) {
      set = new Set();
      byDate.set(ad.keyword, set);
    }
    set.add(s.creativeId);
  }
  const allDomains = Array.from(
    new Set(allAds.map((a) => a.keyword))
  ).sort();
  const sortedDates = Array.from(domainDayCounts.keys()).sort();
  const timeseries = sortedDates.map((date) => {
    const row: Record<string, string | number> = { date };
    const dom = domainDayCounts.get(date)!;
    for (const k of allDomains) {
      row[k] = dom.get(k)?.size ?? 0;
    }
    return row;
  });

  // ── Top movers (largest view delta in range) ────────────────────────
  const movers: {
    creativeId: string;
    advertiserName: string;
    keyword: string;
    youtubeId: string | null;
    title: string;
    viewsBefore: number;
    viewsAfter: number;
    delta: number;
  }[] = [];
  if (haveTrendData) {
    for (const ad of allAds) {
      if (!ad.youtubeId) continue;
      const stats = statsByAd.get(ad.creativeId);
      if (!stats || stats.length < 2) continue;
      const sorted = [...stats].sort((a, b) =>
        a.date.localeCompare(b.date)
      );
      const before = sorted[0].views;
      const after = sorted[sorted.length - 1].views;
      movers.push({
        creativeId: ad.creativeId,
        advertiserName: ad.advertiserName,
        keyword: ad.keyword,
        youtubeId: ad.youtubeId,
        title:
          ad.ytTitle ??
          ad.adLongHeadline ??
          ad.adHeadline ??
          "(제목 없음)",
        viewsBefore: before,
        viewsAfter: after,
        delta: after - before,
      });
    }
    movers.sort((a, b) => b.delta - a.delta);
  }
  const topMovers = movers.slice(0, 10);

  // ── Newest ads (sorted by firstSeen desc) ───────────────────────────
  const newAdsSorted = [...newAds]
    .sort((a, b) => {
      const ta = parseInt(a.firstSeen ?? "0", 10);
      const tb = parseInt(b.firstSeen ?? "0", 10);
      return tb - ta;
    })
    .slice(0, 16)
    .map((a) => ({
      id: a.id,
      creativeId: a.creativeId,
      advertiserId: a.advertiserId,
      advertiserName: a.advertiserName,
      keyword: a.keyword,
      type: a.type,
      youtubeId: a.youtubeId,
      ytTitle: a.ytTitle,
      ytViews: a.ytViews,
      adHeadline: a.adHeadline,
      adLongHeadline: a.adLongHeadline,
      adDescription: a.adDescription,
      previewImage: a.previewImage,
      imageHtml: a.imageHtml,
      firstSeen: a.firstSeen,
      region: a.region,
    }));

  return NextResponse.json({
    range: { days, rangeStart: rangeStartDate, today: todayDate },
    snapshot: {
      totalDays: distinctSnapshotDays.length,
      latestDays: distinctSnapshotDays.slice(0, 7),
      hasTrendData: haveTrendData,
    },
    kpis: {
      activeAds: activeAds.length,
      newAds: newAds.length,
      endedAds: endedAds.length,
      accelTop: accelTopCount,
      spike: spikeCount,
    },
    timeseries,
    domains: allDomains,
    topMovers,
    newAds: newAdsSorted,
  });
}
