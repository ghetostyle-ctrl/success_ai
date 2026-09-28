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
import {
  Activity,
  Calendar,
  CircleStop,
  Clapperboard,
  Flame,
  Globe,
  LayoutDashboard,
  LoaderCircle,
  Package,
  Sparkles,
  Sprout,
  TrendingDown,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";

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

// 차트 색은 스위트 토큰에서 읽는다 (SUITE-DESIGN §4.11). 시리즈 1 = --accent,
// 나머지는 톤 다운된 보조 팔레트 상수.
const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function readChartTheme() {
  return {
    series: [
      css("--accent"),
      "#6b7a90",
      "#3f8f73",
      "#b0822b",
      "#b8505a",
      "#7d6bb3",
      "#8d909c",
      "#0891b2",
    ],
    muted: css("--muted"),
    line: css("--line"),
    surface: css("--surface"),
    ink: css("--ink"),
    fontFamily: css("--font-sans"),
  };
}

type ChartTheme = ReturnType<typeof readChartTheme>;

function colorFor(theme: ChartTheme, index: number) {
  return theme.series[index % theme.series.length];
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

  const theme = useMemo(() => readChartTheme(), []);

  const chartData = useMemo(() => {
    if (!data) return null;
    const labels = data.timeseries.map((p) => p.date as string);
    return {
      labels,
      datasets: data.domains.map((dom, i) => ({
        label: dom,
        data: data.timeseries.map((p) => Number(p[dom] ?? 0)),
        borderColor: colorFor(theme, i),
        backgroundColor: colorFor(theme, i),
        borderWidth: 2,
        tension: 0.3,
        // 점 1개뿐이면 선이 안 그려지므로 그때만 점을 보인다.
        pointRadius: data.timeseries.length === 1 ? 3 : 0,
        pointHoverRadius: 3,
      })),
    };
  }, [data, theme]);

  if (!data) {
    return (
      <div className="panel empty text-sm text-muted" aria-busy={loading}>
        <span className="empty-icon mb-3">
          {loading ? (
            <LoaderCircle size={20} strokeWidth={1.75} aria-hidden className="animate-spin" />
          ) : (
            <LayoutDashboard size={20} strokeWidth={1.75} aria-hidden />
          )}
        </span>
        <div>{loading ? "불러오는 중..." : "데이터 없음"}</div>
      </div>
    );
  }

  const { snapshot, kpis } = data;

  return (
    <div className="space-y-5">
      {/* Header + range toggle */}
      <section className="panel">
        <div className="panel-header flex-wrap">
          <div>
            <h2>
              <LayoutDashboard size={16} strokeWidth={1.75} aria-hidden />
              대시보드
            </h2>
            <p className="mt-1 text-xs tabular-nums text-muted">
              {data.range.rangeStart} ~ {data.range.today} ({range}일치 분석)
            </p>
          </div>
          <div className="segmented">
            {([1, 7, 30] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                aria-pressed={range === r}
              >
                {r === 1 ? "1일" : `${r}일`}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Snapshot status banner (graceful degradation) */}
      {!snapshot.hasTrendData && (
        <div className="notice notice-warning" role="status">
          <Calendar size={16} strokeWidth={1.75} aria-hidden />
          <div className="flex-1 space-y-0.5">
            <div className="font-semibold">
              시계열 스냅샷 누적 중 ({snapshot.totalDays}일치)
            </div>
            <div className="text-ink">
              상승세 / 급등 지표는 스냅샷이 최소 2일치 쌓여야 계산됩니다.
              자동 갱신을 걸어뒀다면 내일부터 채워집니다.
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <KpiCard
          label="활성 광고"
          icon={Activity}
          value={kpis.activeAds}
          unit="개"
          accent="indigo"
          hint={`최근 ${range}일 내 투명성 센터 노출`}
        />
        <KpiCard
          label="새 캠페인"
          icon={Sprout}
          value={kpis.newAds}
          unit="개"
          accent="emerald"
          hint={`첫 노출 ${range}일 이내`}
        />
        <KpiCard
          label="내린 광고"
          icon={CircleStop}
          value={kpis.endedAds}
          unit="개"
          accent="slate"
          hint={`마지막 노출 ${range}일 이전`}
        />
        <KpiCard
          label="상승세 영상"
          icon={TrendingUp}
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
          label="급등"
          icon={Zap}
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
      <section className="panel">
        <div className="panel-header">
          <h2>
            <Globe size={16} strokeWidth={1.75} aria-hidden />
            도메인별 일별 광고 수 추이
          </h2>
        </div>
        <div className="panel-body">
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
                      color: theme.muted,
                      boxWidth: 10,
                      boxHeight: 10,
                      padding: 12,
                      font: { size: 12, family: theme.fontFamily },
                    },
                  },
                  tooltip: {
                    backgroundColor: theme.surface,
                    titleColor: theme.ink,
                    bodyColor: theme.ink,
                    borderColor: theme.line,
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 6,
                  },
                },
                scales: {
                  x: {
                    grid: { color: theme.line },
                    ticks: { color: theme.muted, font: { size: 12, family: theme.fontFamily } },
                  },
                  y: {
                    grid: { color: theme.line },
                    ticks: { color: theme.muted, font: { size: 12, family: theme.fontFamily } },
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
          <div className="mt-2 text-xs text-[var(--text-muted)]">
            ※ 데이터 1점만 있어요. 내일부터 라인이 그려집니다.
          </div>
        )}
        </div>
      </section>

      {/* Top movers */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>
              <Flame size={16} strokeWidth={1.75} aria-hidden />
              가장 큰 변화 (조회수 변동 Top 10)
            </h2>
            <p className="mt-1 text-xs text-muted">
              기간 시작 ↔ 끝 사이 누적 조회수 차이 기준
            </p>
          </div>
        </div>
        {data.topMovers.length === 0 ? (
          <div className="py-12 text-center text-xs text-[var(--text-muted)]">
            {snapshot.hasTrendData
              ? "기간 내 변화 측정된 영상이 없습니다."
              : "스냅샷 2개 이상 쌓이면 표시됩니다."}
          </div>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} aria-label="조회수 변동 Top 10 표">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-soft text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">썸네일</th>
                  <th className="px-3 py-2 text-left font-medium">제목</th>
                  <th className="px-3 py-2 text-left font-medium">광고주</th>
                  <th className="px-3 py-2 text-right font-medium">시작</th>
                  <th className="px-3 py-2 text-right font-medium">끝</th>
                  <th className="px-3 py-2 text-right font-medium">증감</th>
                </tr>
              </thead>
              <tbody>
                {data.topMovers.map((m, i) => (
                  <tr
                    key={m.creativeId}
                    className="border-t border-line transition-colors hover:bg-surface-soft"
                  >
                    <td className="px-3 py-2 text-xs tabular-nums text-faint">
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
                            className="h-12 w-20 rounded-xs object-cover"
                            loading="lazy"
                          />
                        </a>
                      )}
                    </td>
                    <td className="max-w-md px-3 py-2">
                      <div className="line-clamp-2 text-xs font-medium text-[var(--text-primary)]">
                        {m.title}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                      {m.advertiserName}
                      <div className="text-xs text-[var(--text-muted)]">
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
                            ? "inline-flex items-center gap-1 font-semibold text-success"
                            : m.delta < 0
                            ? "inline-flex items-center gap-1 font-semibold text-danger"
                            : "text-[var(--text-muted)]"
                        }
                      >
                        {m.delta > 0 ? (
                          <TrendingUp size={12} strokeWidth={2} aria-hidden />
                        ) : m.delta < 0 ? (
                          <TrendingDown size={12} strokeWidth={2} aria-hidden />
                        ) : null}
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
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>
              <Sparkles size={16} strokeWidth={1.75} aria-hidden />
              최근 등장한 광고 ({data.newAds.length}/{data.kpis.newAds}개)
            </h2>
            <p className="mt-1 text-xs text-muted">
              ATC 첫 노출 {range}일 이내. 새로 시작된 캠페인.
            </p>
          </div>
        </div>
        {data.newAds.length === 0 ? (
          <div className="py-12 text-center text-xs text-[var(--text-muted)]">
            기간 내 신규 광고가 없습니다.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-4">
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
  icon: Icon,
  value,
  unit,
  accent,
  hint,
  dim = false,
}: {
  label: string;
  icon: LucideIcon;
  value: number;
  unit: string;
  accent: "indigo" | "cyan" | "rose" | "emerald" | "orange" | "teal" | "fuchsia" | "slate";
  hint: string;
  dim?: boolean;
}) {
  // 스위트 v1: 지표 값은 accent 색 없이 모두 --ink (SUITE-DESIGN §4.9).
  const accentText: Record<typeof accent, string> = {
    indigo: "text-ink",
    cyan: "text-ink",
    rose: "text-ink",
    emerald: "text-ink",
    orange: "text-ink",
    teal: "text-ink",
    fuchsia: "text-ink",
    slate: "text-ink",
  };
  return (
    <div
      className={`panel p-5 ${
        dim ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <Icon size={14} strokeWidth={1.75} aria-hidden className="text-faint" />
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className={`text-xl font-semibold tabular-nums ${accentText[accent]}`}
        >
          {value.toLocaleString()}
        </span>
        <span className="text-xs text-[var(--text-muted)]">{unit}</span>
      </div>
      <div className="mt-1 text-xs text-faint">{hint}</div>
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
    <div className="overflow-hidden rounded-panel border border-line bg-surface transition-colors hover:border-line-strong hover:shadow-xs">
      <div className="aspect-video w-full overflow-hidden bg-surface-sunken">
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
          <div className="flex h-full w-full items-center justify-center text-faint">
            {ad.type === "video" ? (
              <Clapperboard size={20} strokeWidth={1.75} aria-hidden />
            ) : (
              <Package size={20} strokeWidth={1.75} aria-hidden />
            )}
          </div>
        )}
      </div>
      <div className="space-y-1 p-3">
        <div className="line-clamp-2 text-xs font-medium text-[var(--text-primary)]">
          {title}
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--text-secondary)]">
            {ad.advertiserName || ad.keyword}
          </span>
          <span className="text-[var(--text-muted)]">
            {formatUnixDate(ad.firstSeen)}
          </span>
        </div>
        {ad.ytViews !== null && (
          <div className="text-xs tabular-nums text-muted">
            {ad.ytViews.toLocaleString()}회
          </div>
        )}
      </div>
    </div>
  );
}

export type { DashboardData };
