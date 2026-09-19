/**
 * GET /api/archive — 브랜드 아카이브 카드용 요약.
 *
 * 첫 화면에서 광고 수천 건을 통째로 내려받아 브라우저에서 묶는 대신,
 * 여기서 브랜드(keyword) 단위로 집계해 카드에 필요한 것만 보낸다.
 * 광고가 쌓일수록 차이가 커진다 — 6천 건 전체는 4MB 넘지만 이 응답은
 * 브랜드당 소재 12개라 수십 KB 수준이다.
 *
 * 카드의 "N개 게재 중" 은 반드시 DB 전체 기준이어야 한다. 목록 API 의
 * limit 에 걸린 부분집합으로 세면 실제보다 작은 수가 표시돼 사용자가
 * 수집이 덜 된 줄 안다 (실제로 그렇게 보였다).
 */
import { prisma } from "@/lib/db";

/** 카드 하나에 올릴 소재 수. 가로 캐러셀에서 12개면 충분히 훑인다. */
const CREATIVES_PER_BRAND = 12;
/** 마지막 노출이 이 기간 안이면 "게재 중" 으로 본다. */
const RUNNING_WINDOW_MS = 7 * 86400000;

export async function GET() {
  // 브랜드별 전체 건수 — 여기가 카드 숫자의 근거.
  const totals = await prisma.ad.groupBy({
    by: ["keyword"],
    _count: { _all: true },
  });
  if (totals.length === 0) return Response.json({ brands: [] });

  const watches = await prisma.watch.findMany({
    where: { active: true, kind: "ad" },
    select: { keyword: true },
  });
  const tracked = new Set(watches.map((w) => w.keyword));
  const now = Date.now();

  const brands = await Promise.all(
    totals.map(async (t) => {
      const keyword = t.keyword;

      const [videoCount, advTop, sample] = await Promise.all([
        prisma.ad.count({ where: { keyword, youtubeId: { not: null } } }),
        // 대표 광고주 = 그 브랜드에서 광고가 가장 많은 곳.
        prisma.ad.groupBy({
          by: ["advertiserName"],
          where: { keyword },
          _count: { _all: true },
          orderBy: { _count: { advertiserName: "desc" } },
          take: 1,
        }),
        // 썸네일이 있는 소재만, 조회수 높은 순.
        prisma.ad.findMany({
          where: {
            keyword,
            OR: [{ youtubeId: { not: null } }, { previewImage: { not: null } }],
          },
          orderBy: { ytViews: "desc" },
          take: CREATIVES_PER_BRAND,
          select: {
            creativeId: true,
            advertiserId: true,
            region: true,
            youtubeId: true,
            previewImage: true,
            ytTitle: true,
            ytViews: true,
            adHeadline: true,
            adLongHeadline: true,
            firstSeen: true,
            lastSeen: true,
          },
        }),
      ]);

      // 백분위 분모는 "썸네일 있는 소재 전체" — sample 은 상위 12개뿐이라
      // 그걸로 나누면 12개가 1~100% 로 펼쳐져 순위가 부풀려진다.
      const rankable = await prisma.ad.count({
        where: { keyword, ytViews: { gt: 0 } },
      });

      const creatives = sample.map((a, i) => {
        const first = a.firstSeen ? parseInt(a.firstSeen, 10) * 1000 : null;
        const last = a.lastSeen ? parseInt(a.lastSeen, 10) * 1000 : null;
        return {
          creativeId: a.creativeId,
          thumb: a.youtubeId
            ? `https://i.ytimg.com/vi/${a.youtubeId}/mqdefault.jpg`
            : a.previewImage,
          title:
            a.ytTitle ?? a.adLongHeadline ?? a.adHeadline ?? "(제목 없음)",
          percentile:
            (a.ytViews ?? 0) > 0 && rankable > 0
              ? Math.max(1, Math.round(((i + 1) / rankable) * 100))
              : null,
          views: a.ytViews,
          firstSeenLabel: first
            ? new Date(first).toISOString().slice(0, 10).replace(/-/g, ".")
            : null,
          running: last !== null && now - last < RUNNING_WINDOW_MS,
          runDays:
            first !== null && last !== null
              ? Math.max(1, Math.round((last - first) / 86400000))
              : null,
          link: a.youtubeId
            ? `https://www.youtube.com/watch?v=${a.youtubeId}`
            : `https://adstransparency.google.com/advertiser/${a.advertiserId}/creative/${a.creativeId}?region=${a.region}`,
        };
      });

      return {
        keyword,
        advertiser: advTop[0]?.advertiserName ?? null,
        adCount: t._count._all,
        videoCount,
        region: sample[0]?.region ?? "KR",
        creatives,
        tracked: tracked.has(keyword),
      };
    })
  );

  brands.sort((a, b) => b.adCount - a.adCount);
  return Response.json({ brands });
}
