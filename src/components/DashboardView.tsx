"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

type DashboardData = {
  range: { days: number; rangeStart: string; today: string };
  snapshot: { totalDays: number; latestDays: string[]; hasTrendData: boolean };
  kpis: {
    activeAds: number;
    newAds: number;
    endedAds: number;
    accelTop: number;
    spike: number;
  };
  timeseries: Array<Record<string, string | number>>;
  domains: string[];
  topMovers: Array<{
    creativeId: string;
    advertiserName: string;
    keyword: string;
    youtubeId: string | null;
    title: string;
    viewsBefore: number;
    viewsAfter: number;
    delta: number;
  }>;
  newAds: Array<{
    id: string;
    creativeId: string;
    advertiserId: string;
    advertiserName: string;
    keyword: string;
    type: string;
    youtubeId: string | null;
    ytTitle: string | null;
    ytViews: number | null;
    adHeadline: string | null;
    adLongHeadline: string | null;
    adDescription: string | null;
    previewImage: string | null;
    imageHtml: string | null;
    firstSeen: string | null;
    region: string;
  }>;
};

type Range = 1 | 7 | 30;

// Stable color palette for the line chart
const COLORS = [
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#10b981", // emerald
  "#6366f1", // indigo
  "#06b6d4", // cyan
  "#a855f7", // purple
  "#ec4899", // pink
  "#84cc16", // lime
];

function colorFor(index: number) {
  return COLORS[index % COLORS.length];
}

function formatUnixDate(unix: string | null): string {
  if (!unix) return "-";
  const n = parseInt(unix, 10);
  if (Number.isNaN(n)) return "-";
  return new Date(n * 1000).toISOString().slice(0, 10);
}

function ytLink(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

function ytThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

function atcLink(advertiserId: string, creativeId: string, region: string) {
  return `https://adstransparency.google.com/advertiser/${advertiserId}/creative/${creativeId}?region=${region}`;
}

export default function DashboardView() {
  const [range, setRange] = useState<Range>(7);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard?days=${range}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [range]);

  const chartData = useMemo(() => {
    if (!data) return null;
    const labels = data.timeseries.map((p) => p.date as string);
    return {
      labels,
      datasets: data.domains.map((dom, i) => ({
        label: dom,
        data: data.timeseries.map((p) => Number(p[dom] ?? 0)),
        borderColor: colorFor(i),
        backgroundColor: colorFor(i) + "33",
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
      })),
    };
  }, [data]);

  if (!data) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-card)] px-6 py-16 text-center text-sm text-[var(--text-muted)]">
        {loading ? "불러오는 중..." : "데이터 없음"}
      </div>
    );
  }

  const { snapshot, kpis } = data;

  return (
    <div className="space-y-5">
      {/* Header + range toggle */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">📊 대시보드</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {data.range.rangeStart} ~ {data.range.today} ({range}일치 분석)
            </p>
          </div>
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] p-0.5">
            {([1, 7, 30] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  range === r
                    ? "bg-indigo-500 text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
                }`}
              >
                {r === 1 ? "1일" : `${r}일`}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Snapshot status banner (graceful degradation) */}
      {!snapshot.hasTrendData && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs">
          <div className="flex items-start gap-2">
            <span className="text-base">📅</span>
            <div className="flex-1 space-y-0.5">
              <div className="font-semibold text-amber-700">
                시계열 스냅샷 누적 중 ({snapshot.totalDays}일치)
              </div>
              <div className="text-[var(--text-secondary)]">
                상승세 / 급등 지표는 스냅샷이 최소 2일치 쌓여야 계산됩니다.
                자동 갱신을 걸어뒀다면 내일부터 채워집니다.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label="활성 광고"
          value={kpis.activeAds}
          unit="개"
          accent="indigo"
          hint={`최근 ${range}일 내 투명성 센터 노출`}
        />
        <KpiCard
          label="🌱 새 캠페인"
          value={kpis.newAds}
          unit="개"
          accent="emerald"
          hint={`첫 노출 ${range}일 이내`}
        />
        <KpiCard
          label="🛑 내린 광고"
          value={kpis.endedAds}
          unit="개"
          accent="slate"
          hint={`마지막 노출 ${range}일 이전`}
        />
        <KpiCard
          label="📈 상승세 영상"
          value={kpis.accelTop}
          unit="개"
          accent="teal"
          hint={
            snapshot.hasTrendData
              ? "최근 평균 증가량 ↑"
              : "스냅샷 더 필요"
          }
          dim={!snapshot.hasTrendData}
        />
        <KpiCard
          label="⚡ 급등"
          value={kpis.spike}
          unit="개"
          accent="fuchsia"
          hint={
            snapshot.hasTrendData
              ? "직전 대비 180%+"
              : "스냅샷 더 필요"
          }
          dim={!snapshot.hasTrendData}
        />
      </div>

      {/* Line chart: per-domain ad-count timeseries */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <h3 className="mb-3 text-sm font-semibold">
          🌐 도메인별 일별 광고 수 추이
        </h3>
        {chartData && data.timeseries.length > 0 ? (
          <div className="h-72">
            <Line
              data={chartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: "bottom",
                    labels: {
                      color: "#98a3b8",
                      boxWidth: 10,
                      boxHeight: 10,
                      padding: 12,
                      font: { size: 11 },
                    },
                  },
                  tooltip: {
                    backgroundColor: "#131c2e",
                    titleColor: "#e6e9f2",
                    bodyColor: "#e6e9f2",
                    borderColor: "#243047",
                    borderWidth: 1,
                  },
                },
                scales: {
                  x: {
                    grid: { color: "#243047" },
                    ticks: { color: "#98a3b8", font: { size: 10 } },
                  },
                  y: {
                    grid: { color: "#243047" },
                    ticks: { color: "#98a3b8", font: { size: 10 } },
                    beginAtZero: true,
                  },
                },
              }}
            />
          </div>
        ) : (
          <div className="py-12 text-center text-xs text-[var(--text-muted)]">
            아직 시계열 데이터가 없어요. 검색하면 그날 스냅샷이 쌓이고 매일
            새벽 3시 자동 추적도 동작합니다.
          </div>
        )}
        {data.timeseries.length === 1 && (
          <div className="mt-2 text-[10px] text-[var(--text-muted)]">
            ※ 데이터 1점만 있어요. 내일부터 라인이 그려집니다.
          </div>
        )}
      </section>

      {/* Top movers */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="border-b border-[var(--border)] p-4">
          <h3 className="text-sm font-semibold">
            🔥 가장 큰 변화 (조회수 변동 Top 10)
          </h3>
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            기간 시작 ↔ 끝 사이 누적 조회수 차이 기준
          </p>
        </div>
        {data.topMovers.length === 0 ? (
          <div className="py-12 text-center text-xs text-[var(--text-muted)]">
            {snapshot.hasTrendData
              ? "기간 내 변화 측정된 영상이 없습니다."
              : "스냅샷 2개 이상 쌓이면 표시됩니다."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-elev)] text-xs text-[var(--text-secondary)]">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">#</th>
                  <th className="px-3 py-2 text-left font-semibold">썸네일</th>
                  <th className="px-3 py-2 text-left font-semibold">제목</th>
                  <th className="px-3 py-2 text-left font-semibold">광고주</th>
                  <th className="px-3 py-2 text-right font-semibold">시작</th>
                  <th className="px-3 py-2 text-right font-semibold">끝</th>
                  <th className="px-3 py-2 text-right font-semibold">증감</th>
                </tr>
              </thead>
              <tbody>
                {data.topMovers.map((m, i) => (
                  <tr
                    key={m.creativeId}
                    className="border-t border-[var(--border)] hover:bg-[var(--bg-elev)]"
                  >
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {i + 1}
                    </td>
                    <td className="px-3 py-2">
                      {m.youtubeId && (
                        <a
                          href={ytLink(m.youtubeId)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <img
                            src={ytThumbnail(m.youtubeId)}
                            alt=""
                            className="h-12 w-20 rounded object-cover"
                            loading="lazy"
                          />
                        </a>
                      )}
                    </td>
                    <td className="max-w-md px-3 py-2">
                      <div className="line-clamp-2 text-[12px] font-medium text-[var(--text-primary)]">
                        {m.title}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                      {m.advertiserName}
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {m.keyword}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {m.viewsBefore.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--text-primary)]">
                      {m.viewsAfter.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span
                        className={
                          m.delta > 0
                            ? "font-bold text-emerald-600"
                            : m.delta < 0
                            ? "font-bold text-rose-600"
                            : "text-[var(--text-muted)]"
                        }
                      >
                        {m.delta > 0 ? "+" : ""}
                        {m.delta.toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* New ads grid */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="border-b border-[var(--border)] p-4">
          <h3 className="text-sm font-semibold">
            ✨ 최근 등장한 광고 ({data.newAds.length}/{data.kpis.newAds}개)
          </h3>
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            ATC 첫 노출 {range}일 이내. 새로 시작된 캠페인.
          </p>
        </div>
        {data.newAds.length === 0 ? (
          <div className="py-12 text-center text-xs text-[var(--text-muted)]">
            기간 내 신규 광고가 없습니다.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
            {data.newAds.map((ad) => (
              <NewAdCard key={ad.id} ad={ad} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  unit,
  accent,
  hint,
  dim = false,
}: {
  label: string;
  value: number;
  unit: string;
  accent: "indigo" | "cyan" | "rose" | "emerald" | "orange" | "teal" | "fuchsia" | "slate";
  hint: string;
  dim?: boolean;
}) {
  const accentText: Record<typeof accent, string> = {
    indigo: "text-indigo-600",
    cyan: "text-cyan-600",
    rose: "text-rose-600",
    emerald: "text-emerald-600",
    orange: "text-orange-600",
    teal: "text-teal-600",
    fuchsia: "text-fuchsia-600",
    slate: "text-slate-500",
  };
  return (
    <div
      className={`rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 ${
        dim ? "opacity-60" : ""
      }`}
    >
      <div className="text-[11px] text-[var(--text-secondary)]">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className={`text-2xl font-bold tabular-nums ${accentText[accent]}`}
        >
          {value.toLocaleString()}
        </span>
        <span className="text-xs text-[var(--text-muted)]">{unit}</span>
      </div>
      <div className="mt-1 text-[10px] text-[var(--text-muted)]">{hint}</div>
    </div>
  );
}

function NewAdCard({ ad }: { ad: DashboardData["newAds"][number] }) {
  const title =
    ad.ytTitle ??
    ad.adLongHeadline ??
    ad.adHeadline ??
    `${ad.advertiserName} 광고`;
  const showThumb =
    ad.youtubeId || (ad.type === "image" && ad.imageHtml) || ad.previewImage;
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] transition hover:border-[var(--border-strong)]">
      <div className="aspect-video w-full overflow-hidden bg-[var(--bg-elev)]">
        {ad.youtubeId ? (
          <a
            href={ytLink(ad.youtubeId)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src={ytThumbnail(ad.youtubeId)}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </a>
        ) : ad.type === "image" && ad.imageHtml ? (
          <a
            href={atcLink(ad.advertiserId, ad.creativeId, ad.region)}
            target="_blank"
            rel="noopener noreferrer"
            className="block h-full w-full"
          >
            <div
              className="flex h-full w-full items-center justify-center [&>img]:max-h-full [&>img]:max-w-full [&>img]:object-cover"
              dangerouslySetInnerHTML={{ __html: ad.imageHtml }}
            />
          </a>
        ) : ad.previewImage ? (
          <a
            href={atcLink(ad.advertiserId, ad.creativeId, ad.region)}
            target="_blank"
            rel="noopener noreferrer"
            className="block h-full w-full"
          >
            <img
              src={ad.previewImage}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </a>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-[var(--text-muted)]">
            {ad.type === "video" ? "🎬" : "📦"}
          </div>
        )}
      </div>
      <div className="space-y-1 p-3">
        <div className="line-clamp-2 text-[12px] font-medium text-[var(--text-primary)]">
          {title}
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-[var(--text-secondary)]">
            {ad.advertiserName || ad.keyword}
          </span>
          <span className="text-[var(--text-muted)]">
            {formatUnixDate(ad.firstSeen)}
          </span>
        </div>
        {ad.ytViews !== null && (
          <div className="text-[10px] tabular-nums text-rose-600">
            {ad.ytViews.toLocaleString()}회
          </div>
        )}
      </div>
    </div>
  );
}

export type { DashboardData };
