"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
// 첫 진입 tab='ads' 만 보임. 나머지 view 는 dynamic import 로 lazy —
// 사용자가 그 tab 클릭 시 그제서야 chunk 다운로드.
const DashboardView = dynamic(() => import("@/components/DashboardView"), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-sm text-[var(--text-muted)]">대시보드 로딩…</div>,
});
import BrandArchive, { type ArchiveBrand } from "@/components/BrandArchive";

const GuideView = dynamic(() => import("@/components/GuideView"), {
  ssr: false,
  loading: () => (
    <div className="p-8 text-center text-sm text-[var(--text-muted)]">
      사용법 로딩…
    </div>
  ),
});
const MetaView = dynamic(() => import("@/components/MetaView"), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-sm text-[var(--text-muted)]">메타 로딩…</div>,
});

type Job = {
  id: string;
  keyword: string;
  kind: string; // 'ad' | 'youtube'
  status: string;
  errorMsg?: string | null;
  resultCount: number;
  adCount: number;
  createdAt: string;
};

type Watch = {
  id: string;
  keyword: string;
  kind: string;
  region: string;
  active: boolean;
  daily?: boolean; // true=매일, false=격일(기본)
  tier?: string | null; // "A1"|"A2"|"A3"|null — 중요도 그룹 (색 chip)
  tags?: string | null; // JSON 배열 문자열 (예: '["식이섬유"]')
  createdAt: string;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastRunNote?: string | null;
};

// tier 시각화 상수 — 레퍼런스 도구 벤치마크 (2026-07-13). A1=레드(최우선),
// A2=오렌지, A3=옐로우. null=미지정 (무채색).
const TIER_META: Record<string, { label: string; dot: string; chip: string }> = {
  A1: { label: "A1", dot: "bg-rose-500", chip: "bg-rose-500/15 text-rose-700 border-rose-500/40" },
  A2: { label: "A2", dot: "bg-orange-500", chip: "bg-orange-500/15 text-orange-700 border-orange-500/40" },
  A3: { label: "A3", dot: "bg-yellow-500", chip: "bg-yellow-500/15 text-yellow-700 border-yellow-500/40" },
};
const TIER_CYCLE: (string | null)[] = ["A1", "A2", "A3", null];

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

// Meta sidebar grouping types — kept loose because /api/meta-watch may
// or may not include `source` / `anchorKeyword` depending on whether
// the running Prisma client picked up the latest schema migration.
type MetaWatchRow = {
  id: string;
  keyword: string;
  region: string;
  active: boolean;
  anchorKeyword?: string | null;
  source?: "seed" | "manual" | "auto" | string | null;
  lastRunAt?: string | null;
  lastRunNote?: string | null;
};

type MetaJobRow = {
  id: string;
  keyword: string;
  region: string;
  status: "queued" | "in_progress" | "complete" | "error";
  adCount: number;
  pageCount: number;
  errorMsg: string | null;
  createdAt: string;
};

type Video = {
  id: string;
  title: string;
  channel: string;
  youtube: string;
  thumbnail: string;
  type: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  keyword: string;
  jobId?: string | null;
  savedAt?: string;
};

type AdStat = {
  capturedDate: string; // YYYY-MM-DD
  views: number;
  likes: number;
  comments: number;
};

type Ad = {
  id: string;
  advertiserId: string;
  advertiserName: string;
  creativeId: string;
  type: string;
  region: string;
  firstSeen: string | null;
  lastSeen: string | null;
  previewUrl: string | null;
  imageHtml: string | null;
  obfuscatedCustomerId: string | null;
  keyword: string;
  // 도메인 검색에서 어느 stage 의 광고인지 — "domain"=Stage1 직접 광고,
  // "advertiser"=Stage3 형제 brand. domainOnly 토글의 필터 기준.
  via: "domain" | "advertiser" | null;

  youtubeId: string | null;
  ytTitle: string | null;
  ytChannel: string | null;
  ytPublishedAt: string | null;
  ytViews: number | null;
  ytLikes: number | null;
  ytComments: number | null;
  ytDurationSec: number | null;
  ytFetchedAt: string | null;

  previewImage: string | null;

  adHeadline: string | null;
  adLongHeadline: string | null;
  adDescription: string | null;

  stats?: AdStat[];

  jobId?: string | null;
  savedAt?: string;
};

/**
 * 첫 화면에서 받아올 광고 수 상한. savedAt desc 로 잘리므로, 이 값이 낮으면
 * 최근 수집한 광고주만 로드돼 광고주/채널 필터가 한 곳으로 좁아진다.
 * 이 상한에 걸리면 목록 상단에 "일부만 불러옴" 안내가 뜬다.
 */
const INITIAL_ADS_LIMIT = 5000;

type Classification =
  | "신규광고"
  | "신규영상"
  | "히어로"
  | "가속도"
  | "스파이크"
  | "피로도";

function classifyAd(ad: Ad): Classification[] {
  const result: Classification[] = [];

  // 🌱 신규광고: ATC firstSeen within last 10 days
  // (the AD CAMPAIGN started recently — the video itself may be old)
  if (ad.firstSeen) {
    const firstSeenMs = parseInt(ad.firstSeen, 10) * 1000;
    if (!isNaN(firstSeenMs)) {
      const tenDaysAgo = Date.now() - 10 * 86400000;
      if (firstSeenMs >= tenDaysAgo) result.push("신규광고");
    }
  }

  // 🎞 신규영상: YouTube publishedAt within last 21 days
  if (ad.ytPublishedAt) {
    const publishedMs = new Date(ad.ytPublishedAt).getTime();
    if (!isNaN(publishedMs)) {
      const threeWeeksAgo = Date.now() - 21 * 86400000;
      if (publishedMs >= threeWeeksAgo) result.push("신규영상");
    }
  }

  // ⭐ 주력: views >= 500k AND daily views >= 5k (stable high-performer).
  // 100만/1만 기준은 대형 광고주만 걸려서 중소 브랜드 계정에서는 배지가
  // 거의 안 붙었다. 절반으로 낮춰 실제 분포에 맞춤.
  if ((ad.ytViews ?? 0) >= 500_000) {
    const dpd = dailyViews(ad.ytViews, ad.ytPublishedAt);
    if (dpd >= 5_000) result.push("히어로");
  }

  // The trend-based labels need at least 2 daily snapshots
  const stats = ad.stats ?? [];
  if (stats.length >= 2) {
    const sorted = [...stats].sort(
      (a, b) =>
        new Date(a.capturedDate).getTime() -
        new Date(b.capturedDate).getTime()
    );
    const deltas: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      deltas.push(sorted[i].views - sorted[i - 1].views);
    }
    const lastDelta = deltas[deltas.length - 1];
    const prevDelta = deltas.length >= 2 ? deltas[deltas.length - 2] : 0;

    // ⚡ 급등: latest delta >= 180% of previous delta
    if (prevDelta > 80 && lastDelta >= prevDelta * 1.8) {
      result.push("스파이크");
    }

    // 📈 상승세: recent 3-day avg delta > overall avg * 1.25
    if (deltas.length >= 3) {
      const recent = deltas.slice(-3).reduce((a, b) => a + b, 0) / 3;
      const overall = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      if (recent > overall * 1.25 && recent > 800) result.push("가속도");
    }

    // 📉 둔화: last 3 deltas declining and last < 60% of first-of-three
    if (deltas.length >= 3) {
      const last3 = deltas.slice(-3);
      if (
        last3[0] > last3[1] &&
        last3[1] > last3[2] &&
        last3[2] < last3[0] * 0.6
      ) {
        result.push("피로도");
      }
    }
  }

  return result;
}

/**
 * 상태 정렬 순위 — classifyAd가 반환한 배지들 중 "가장 강한 신호"의 점수를 반환.
 * 높을수록 정렬 우선(desc 기준 위로). 광고가 여러 상태를 동시에 가지면 max 채택.
 * 순위: 히어로 > 스파이크 > 가속도 > 신규광고 > 신규영상 > 일반(0) > 피로도(음수).
 * AdRow 의 상태 배지(classifyAd)와 동일 기준을 사용해 표시/정렬 일관성 유지.
 */
const STATUS_RANK: Record<Classification, number> = {
  히어로: 6,
  스파이크: 5,
  가속도: 4,
  신규광고: 3,
  신규영상: 2,
  피로도: -1,
};
function statusRank(ad: Ad): number {
  const classes = classifyAd(ad);
  if (classes.length === 0) return 0; // 일반 (배지 없음)
  return Math.max(...classes.map((c) => STATUS_RANK[c]));
}

const CLASSIFICATION_META: Record<
  Classification,
  { emoji: string; label: string; tip: string; bg: string; text: string }
> = {
  신규광고: {
    emoji: "🌱",
    label: "새 캠페인",
    tip: "이 광고가 투명성 센터에 처음 잡힌 지 10일 이내. 영상 자체는 오래됐어도 집행은 새로 시작된 것.",
    bg: "bg-lime-500/20",
    text: "text-lime-700",
  },
  신규영상: {
    emoji: "🎞",
    label: "새 소재",
    tip: "YouTube 영상이 최근 21일 이내에 게시됨.",
    bg: "bg-violet-500/20",
    text: "text-violet-700",
  },
  히어로: {
    emoji: "⭐",
    label: "주력",
    tip: "누적 50만+ 조회수 AND 일평균 5천+ — 오래 밀고 있는 간판 소재.",
    bg: "bg-indigo-500/20",
    text: "text-indigo-700",
  },
  가속도: {
    emoji: "📈",
    label: "상승세",
    tip: "최근 3일 평균 증가량이 전체 평균의 1.25배 이상. (스냅샷 3+개 필요)",
    bg: "bg-teal-500/20",
    text: "text-teal-700",
  },
  스파이크: {
    emoji: "⚡",
    label: "급등",
    tip: "직전 대비 180% 이상 폭증. (스냅샷 2+개 필요)",
    bg: "bg-fuchsia-500/20",
    text: "text-fuchsia-700",
  },
  피로도: {
    emoji: "📉",
    label: "둔화",
    tip: "최근 3일 연속 증가량 하락. (스냅샷 3+개 필요)",
    bg: "bg-slate-400/25",
    text: "text-slate-600",
  },
};

type Tab = "archive" | "ads" | "meta" | "creatives" | "dashboard" | "guide";
type CreativesSort =
  | "views"
  | "daily"
  | "date"
  | "likes"
  | "comments"
  | "campaigns"; // 같은 영상이 몇 개 광고 캠페인에 재사용됐나 — 많을수록 광고주가 검증한 소재
type LogLevel = "info" | "success" | "warn" | "error";
type LogLine = { time: Date; msg: string; level: LogLevel };
type AdSortKey =
  | "views"
  | "daily"
  | "date"
  | "likes"
  | "comments"
  | "delta"
  | "growth"
  | "status";
type SortDir = "asc" | "desc";

function looksLikeDomain(query: string): boolean {
  const q = query.trim();
  if (!q || /\s/.test(q) || !/\./.test(q)) return false;
  const stripped = q.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}/i.test(stripped);
}

function daysBetween(dateStr: string | null): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  return Math.max(1, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function dailyViews(views: number | null, publishedAt: string | null): number {
  if (!views || !publishedAt) return 0;
  return Math.floor(views / daysBetween(publishedAt));
}

/**
 * D+N — "광고가 ATC에 처음 노출된 지 며칠 됐나"
 * Ad.firstSeen 는 unix seconds (string). 미존재면 null 반환.
 */
/**
 * 사이드바에 raw error 메시지 보여주는 대신, 사용자가 알아먹는 한 줄
 * 안내로 변환. 대부분의 ATC 실패는 Google이 PC IP를 봇으로 의심해서
 * google.com/sorry/index 로 보내는 경우인데, 그걸 raw HTML 그대로
 * 보여주면 "오류가 심하다"는 인상을 줌.
 */
function humanizeErrorMsg(raw: string): string {
  const s = raw.toLowerCase();
  if (
    s.includes("sorry/index") ||
    s.includes("bot challenge") ||
    s.includes("302") ||
    s.includes("recaptcha")
  ) {
    return "🤖 Google이 이 IP를 봇으로 의심 중 — 1~3시간 후 재시도";
  }
  if (s.includes("curl exit 28") || s.includes("timeout"))
    return "⏱ 네트워크 timeout — 잠시 후 재시도";
  if (s.includes("curl exit 6") || s.includes("could not resolve"))
    return "📡 DNS 해석 실패 — 네트워크 확인";
  if (s.includes("curl exit 56") || s.includes("connection reset"))
    return "📡 연결 끊김 — 잠시 후 재시도";
  if (s.includes("fetch failed")) return "📡 fetch 실패 — 네트워크 확인";
  // fallback: 80자 cap
  return raw.length > 80 ? raw.slice(0, 80) + "…" : raw;
}

/**
 * progress.step (server-side phase tag) → user-friendly label.
 * "atc" → "📡 광고 페이지 수집 중", etc.
 */
/**
 * 태그별 색상 자동 배정 — 같은 태그는 어디서든 같은 색.
 * hash(tag) → 8개 팔레트 중 하나 (Tailwind classes).
 * 한국 사용자가 식이섬유/화장품/음료/건강식품 등으로 라벨링 시
 * chip + 카드 표시 모두 같은 색으로 일관성.
 */
const TAG_PALETTE = [
  { bg: "bg-cyan-500/20", border: "border-cyan-500/40", text: "text-cyan-700", ring: "ring-cyan-500/50", active: "bg-cyan-500/30 text-cyan-200" },
  { bg: "bg-amber-500/20", border: "border-amber-500/40", text: "text-amber-700", ring: "ring-amber-500/50", active: "bg-amber-500/30 text-amber-200" },
  { bg: "bg-rose-500/20", border: "border-rose-500/40", text: "text-rose-700", ring: "ring-rose-500/50", active: "bg-rose-500/30 text-rose-200" },
  { bg: "bg-emerald-500/20", border: "border-emerald-500/40", text: "text-emerald-700", ring: "ring-emerald-500/50", active: "bg-emerald-500/30 text-emerald-200" },
  { bg: "bg-violet-500/20", border: "border-violet-500/40", text: "text-violet-700", ring: "ring-violet-500/50", active: "bg-violet-500/30 text-violet-200" },
  { bg: "bg-sky-500/20", border: "border-sky-500/40", text: "text-sky-700", ring: "ring-sky-500/50", active: "bg-sky-500/30 text-sky-200" },
  { bg: "bg-orange-500/20", border: "border-orange-500/40", text: "text-orange-700", ring: "ring-orange-500/50", active: "bg-orange-500/30 text-orange-200" },
  { bg: "bg-pink-500/20", border: "border-pink-500/40", text: "text-pink-700", ring: "ring-pink-500/50", active: "bg-pink-500/30 text-pink-200" },
] as const;
function tagColor(tag: string): (typeof TAG_PALETTE)[number] {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

function phaseLabel(step: string): string {
  switch (step) {
    case "starting":
      return "🚀 시작 중";
    case "atc":
      return "📡 광고 페이지 수집 중";
    case "save":
      return "💾 DB 저장 중";
    case "yt-extract":
      return "🎬 YouTube 영상 매칭 중";
    case "yt-stats":
      return "📊 영상 통계 수집 중";
    case "done":
      return "✅ 완료";
    default:
      return step;
  }
}

/**
 * 큰 숫자를 컴팩트하게 — 56,487,393 → "5,648만" 또는 "56.5M".
 * 한국 사용자는 만/억 단위가 익숙. 풀 숫자는 호버 tooltip으로.
 */
function formatCompactNum(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) {
    const man = abs / 10_000;
    return `${sign}${man >= 100 ? Math.round(man).toLocaleString() : man.toFixed(1)}만`;
  }
  return n.toLocaleString();
}

function dPlusN(firstSeen: string | null): number | null {
  if (!firstSeen) return null;
  const ts = parseInt(firstSeen, 10);
  if (isNaN(ts)) return null;
  const days = Math.floor((Date.now() - ts * 1000) / 86400000);
  return Math.max(0, days);
}

/**
 * 분석 기간 종류. "all" = 추적 시작부터 끝까지 (snapshot 첫~끝).
 */
type AnalyzeDays = 7 | 14 | 30 | 90 | "all";

/**
 * 조회수 변화 분석 — AdStat 시계열에서 분석 기간 시작점과 끝점의 차이를 뽑음.
 *   delta:    절대 증감 (after - before)
 *   percent:  성장률 (delta / before * 100)
 *   before:   기간 시작 시점 조회수 (없으면 가장 이른 snapshot)
 *   after:    기간 끝(최신) 시점 조회수
 *   avgPerDay: 일평균 증감 (delta / 실제 기간 일수)
 *   daysSpan: 실제 측정된 기간 일수 (snapshot 첫~끝 사이)
 * snapshot 2개 미만이면 모두 0.
 */
function viewsChange(
  ad: Ad,
  range: AnalyzeDays
): {
  delta: number;
  percent: number;
  before: number;
  after: number;
  avgPerDay: number;
  daysSpan: number;
  hasData: boolean;
} {
  const stats = ad.stats ?? [];
  const empty = {
    delta: 0,
    percent: 0,
    before: 0,
    after: ad.ytViews ?? 0,
    avgPerDay: 0,
    daysSpan: 0,
    hasData: false,
  };
  if (stats.length === 0) return empty;
  const sorted = [...stats].sort(
    (a, b) =>
      new Date(a.capturedDate).getTime() - new Date(b.capturedDate).getTime()
  );
  // Window filter — "all" = 전체 snapshot 사용.
  const cutoff =
    range === "all" ? -Infinity : Date.now() - range * 86400000;
  const inWindow = sorted.filter(
    (s) => new Date(s.capturedDate).getTime() >= cutoff
  );
  // 기간 내 snapshot 2개 이상이어야 의미 있음. 부족하면 전체 fallback.
  const series = inWindow.length >= 2 ? inWindow : sorted;
  if (series.length < 2) return empty;
  const first = series[0];
  const last = series[series.length - 1];
  const before = first.views;
  const after = last.views;
  const delta = after - before;
  const daysSpan = Math.max(
    1,
    Math.floor(
      (new Date(last.capturedDate).getTime() -
        new Date(first.capturedDate).getTime()) /
        86400000
    )
  );
  return {
    delta,
    percent: before > 0 ? (delta / before) * 100 : 0,
    before,
    after,
    avgPerDay: Math.floor(delta / daysSpan),
    daysSpan,
    hasData: true,
  };
}

function ytLink(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

function isShellAd(ad: Ad): boolean {
  // Shell-channel imports use synthetic ids ("shell:UC…", "yt:<videoId>")
  // because they don't exist in ATC's public index. Falling through to
  // atcLink() would 404 — return the YouTube watch URL instead.
  return ad.advertiserId.startsWith("shell:") || ad.creativeId.startsWith("yt:");
}

function atcLink(ad: Ad): string {
  if (isShellAd(ad) && ad.youtubeId) return ytLink(ad.youtubeId);
  return `https://adstransparency.google.com/advertiser/${ad.advertiserId}/creative/${ad.creativeId}?region=${ad.region}`;
}

/**
 * 브랜드 아바타 — 키워드에서 이니셜 한 글자와 색을 뽑는다. 색을 해시로
 * 고정해야 목록을 다시 열어도 같은 자리로 인식된다 (랜덤이면 매번 바뀐다).
 * BrandArchive 카드와 같은 규칙이라 사이드바 ↔ 카드가 같은 색으로 묶인다.
 */
function brandInitial(keyword: string): string {
  const stem = keyword.replace(/^www\./, "").split(".")[0];
  return (stem[0] ?? "?").toUpperCase();
}
function brandHue(keyword: string): number {
  let h = 0;
  for (let i = 0; i < keyword.length; i++) {
    h = (h * 31 + keyword.charCodeAt(i)) % 360;
  }
  return h;
}

function ytThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

function formatUnixDate(unix: string | null): string {
  if (!unix) return "-";
  const n = parseInt(unix, 10);
  if (Number.isNaN(n)) return "-";
  return new Date(n * 1000).toISOString().slice(0, 10);
}

function adDate(ad: Ad): number {
  // Returns timestamp for sorting; prefers YouTube publishedAt, falls back to first-seen unix
  if (ad.ytPublishedAt) {
    const t = new Date(ad.ytPublishedAt).getTime();
    if (!isNaN(t)) return t;
  }
  if (ad.firstSeen) {
    const t = parseInt(ad.firstSeen, 10);
    if (!isNaN(t)) return t * 1000;
  }
  return 0;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("archive");
  const [adQuery, setAdQuery] = useState("");
  const [ytQuery, setYtQuery] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [deleteSecret, setDeleteSecret] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteDone, setDeleteDone] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [metaWatches, setMetaWatches] = useState<MetaWatchRow[]>([]);
  const [metaJobs, setMetaJobs] = useState<MetaJobRow[]>([]);
  const [filter, setFilter] = useState<"all" | "hero" | "growing">("all");
  // 조회수 대역 필터 — 레퍼런스 도구 벤치마크. "" = 전체. "min:max" 형식
  // (max 없으면 무한). 1000만+ 메가히트 등 소재 성과 대역별 브라우징.
  const [viewBand, setViewBand] = useState("");
  // 소재 나이 필터 — "" 전체 / "old:30" 롱런 (30일+ 살아있는 광고 =
  // 검증된 소재) / "old:90" 스테디셀러. firstSeen 기준.
  const [ageBand, setAgeBand] = useState("");

  // 🎯 이 도메인만 토글 — ATC fan-out (Stage3) 의 형제 brand 광고를 숨기고
  // 도메인 검색이 직접 끌어온 광고만 표시. brand-d.co.kr 검색 시 브랜드E/
  // 브랜드F 빠지고 브랜드D만 남음. via 가 null 인 레거시 광고도 같이 숨겨짐 →
  // 재수집해야 채워짐. via 가 한 개라도 있는 keyword 일 때만 토글 표시.
  const [domainOnly, setDomainOnly] = useState(false);
  // 결과 내 채널 chip multi-select — innerSearch 와 AND. chip 누르면 그
  // 채널만 표시, 다시 누르면 해제. 비어있으면 전체. ATC 의 ytChannel /
  // 메타의 advertiserName 을 합쳐서 unique key 로.
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(
    new Set()
  );
  // 검색 결과 내부 필터 — ATC 가 광고주(예: 모브랜드사) 전체 광고를
  // 끌어오기 때문에 한 회사의 여러 brand(브랜드D/브랜드E/브랜드F)가 섞임.
  // 제목/채널/광고주명 contains 매칭으로 좁힌다.
  const [innerSearch, setInnerSearch] = useState("");
  const [adTypeFilter, setAdTypeFilter] = useState<
    "all" | "image" | "video" | "other" | "youtube"
  >("all");
  const [loaded, setLoaded] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  // selectedKeyword 변경 시 그 keyword의 광고를 server에서 별도 fetch.
  // 첫 진입 fetch 는 limit=300이라 selectedKeyword brand 광고가 다 안 들어
  // 있을 수 있음. 사용자가 brand 클릭 → 그 keyword full fetch → 기존 ads
  // 와 merge (dedup by creativeId). 작은 응답 (보통 100~500개) 빠름.
  useEffect(() => {
    if (!selectedKeyword) return;
    // limit=5000: brand-h(8190개) 같은 거대 광고주 클릭 시 payload 폭발
    // 방지 (레퍼런스 도구 는 "거대 광고주" 별도 페이지로 분리 — 우리는 fetch cap
    // 으로 대응). savedAt desc 라 최근 수집분 우선. UI 는 displayLimit
    // 200 씩 보여주므로 체감 없음.
    fetch(`/api/ads?withStats=false&limit=5000&keyword=${encodeURIComponent(selectedKeyword)}`)
      .then((r) => r.json())
      .then((d: { ads: Ad[] }) => {
        if (!d.ads?.length) return;
        setAds((prev) => {
          const seen = new Set(prev.map((a) => a.creativeId));
          const newOnes = d.ads.filter((a) => !seen.has(a.creativeId));
          return newOnes.length === 0 ? prev : [...prev, ...newOnes];
        });
      })
      .catch(() => {});
  }, [selectedKeyword]);

  // brand 선택 시 "🎯 이 도메인만" 자동 ON (사용자 요청 2026-07-01).
  // brand-h 처럼 광고주(모비데이즈)가 미디어커머스 홀딩이라 광고주 fan-out
  // 결과가 다른 brand 광고로 도배되는 경우 매번 토글 클릭 부담. 도메인
  // 검색 = "이 brand 만 보고 싶음" 이 default 의도라 자동으로 도메인만.
  // 사용자가 fan-out 결과 보고 싶으면 토글 클릭해서 끔 (여전히 가능).
  useEffect(() => {
    if (selectedKeyword) setDomainOnly(true);
  }, [selectedKeyword]);

  // Sidebar source toggle — splits the brand list into 🟦 구글 / 📘 메타
  // so users don't have to scroll past all Google brands to find Meta brands.
  // Auto-synced to the main tab below: switching to meta tab → sidebar flips
  // to meta; manual toggle clicks override until the next main-tab change.
  const [sidebarSource, setSidebarSource] = useState<"google" | "meta">(
    "google"
  );
  useEffect(() => {
    if (tab === "meta") setSidebarSource("meta");
    else if (tab === "ads" || tab === "creatives" || tab === "dashboard")
      setSidebarSource("google");
  }, [tab]);

  // Sorting (ads tab)
  const [sortKey, setSortKey] = useState<AdSortKey>("views");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // 누적 소재 (creatives) sort + classification filter
  const [creativesSort, setCreativesSort] = useState<CreativesSort>("views");
  const [creativesSortDir, setCreativesSortDir] = useState<SortDir>("desc");
  const [classFilter, setClassFilter] = useState<Classification | "all">("all");
  const [copiedCount, setCopiedCount] = useState<number | null>(null);

  // 분석 기간 — delta/%/D+N 컬럼이 어느 윈도우 기준으로 계산될지.
  // 광고 수집 탭 상단 셀렉터 + AdsTable에 prop으로 전달. default 7일.
  const [analyzeDays, setAnalyzeDays] = useState<AnalyzeDays>(7);

  // 광고 테이블 표시 cap — 한 번에 너무 많은 썸네일 fetch 하면 첫 paint
  // 후 background 40초+. 200개로 cap, "+200개" 버튼으로 점진 확장.
  const [displayLimit, setDisplayLimit] = useState(200);

  // 사이드바 자동수집 위젯의 "누락" 펼침 토글
  const [showMissing, setShowMissing] = useState(false);

  /**
   * 태그 시스템 — keyword(광고주 도메인)에 카테고리 태그 (예: 식이섬유,
   * 전자기기, 화장품) 라벨링. localStorage 기반 클라이언트 저장이라
   * 디바이스 간 동기화 안 됨 — 그래도 한 사용자 한 PC가 주 케이스라 충분.
   *
   * 데이터 모양: { "example.co.kr": ["식이섬유"], "example-shop.com": [...] }
   * - 한 keyword에 여러 태그 가능
   * - 모든 태그 합집합 = 필터 chip 후보
   *
   * 향후 D1로 옮길 때는 schema에 KeywordTag 테이블 추가 + API route 만들고
   * 이 useEffect의 localStorage 부분만 fetch로 교체하면 됨.
   */
  const TAGS_STORAGE_KEY = "mavai:tags:v1";
  const [tagMap, setTagMap] = useState<Record<string, string[]>>({});
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  // 태그 편집 UI 토글 — 어떤 keyword 카드가 inline-input 펼친 상태인지.
  const [editingTagFor, setEditingTagFor] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(TAGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object")
          setTagMap(parsed as Record<string, string[]>);
      }
    } catch {
      /* corrupt JSON — ignore */
    }
  }, []);
  const saveTagMap = useCallback((next: Record<string, string[]>) => {
    setTagMap(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(TAGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* quota / disabled storage — best effort */
      }
    }
  }, []);

  // 태그 DB 동기화 — localStorage 는 개인 브라우저 전용이라 팀원 간 공유
  // 안 됨 (레퍼런스 도구 벤치마크 후 개선 2026-07-13). 변경된 keyword 만 서버
  // Watch.tags 에 저장. 실패해도 localStorage 는 이미 반영 (best effort).
  const pushTagsToServer = useCallback((keyword: string, tags: string[]) => {
    void fetch("/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, kind: "ad", tags }),
    }).catch(() => {});
  }, []);
  const addTag = useCallback(
    (keyword: string, tag: string) => {
      const t = tag.trim();
      if (!t) return;
      const existing = tagMap[keyword] ?? [];
      if (existing.includes(t)) return;
      const nextTags = [...existing, t];
      saveTagMap({ ...tagMap, [keyword]: nextTags });
      pushTagsToServer(keyword, nextTags);
    },
    [tagMap, saveTagMap, pushTagsToServer]
  );
  const removeTag = useCallback(
    (keyword: string, tag: string) => {
      const existing = tagMap[keyword] ?? [];
      const next = existing.filter((x) => x !== tag);
      if (next.length === 0) {
        const copy = { ...tagMap };
        delete copy[keyword];
        saveTagMap(copy);
      } else {
        saveTagMap({ ...tagMap, [keyword]: next });
      }
      pushTagsToServer(keyword, next);
    },
    [tagMap, saveTagMap, pushTagsToServer]
  );
  // 모든 태그 합집합 — sidebar 필터 chip 후보로 사용.
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const arr of Object.values(tagMap)) for (const t of arr) s.add(t);
    return Array.from(s).sort();
  }, [tagMap]);

  // 스냅샷 타임라인 — 선택된 keyword의 광고들이 갖고 있는 모든
  // AdStat.capturedDate 의 union. 가로 chip 행으로 표시 + 클릭 시
  // "그 날 이후 firstSeen 인 광고만" 필터링 ("이후 등장한 광고" 모드).
  // null = 전체 보기.
  const [sinceDateFilter, setSinceDateFilter] = useState<string | null>(null);
  const snapshotTimeline = useMemo(() => {
    if (!selectedKeyword) return null;
    const kwAds = ads.filter((a) => a.keyword === selectedKeyword);
    const dates = new Set<string>();
    for (const a of kwAds) {
      for (const s of a.stats ?? []) dates.add(s.capturedDate);
    }
    const sortedDates = Array.from(dates).sort();
    if (sortedDates.length === 0) return null;
    // 각 date별로 그 날 이후 firstSeen인 광고 개수 — chip의 차이 표시용.
    const newSince = (date: string) => {
      const cutoff = new Date(date).getTime();
      let n = 0;
      for (const a of kwAds) {
        if (!a.firstSeen) continue;
        const t = parseInt(a.firstSeen, 10) * 1000;
        if (!isNaN(t) && t >= cutoff) n++;
      }
      return n;
    };
    return {
      dates: sortedDates,
      first: sortedDates[0],
      last: sortedDates[sortedDates.length - 1],
      newSince,
      totalAds: kwAds.length,
    };
  }, [selectedKeyword, ads]);
  // sinceDateFilter 적용은 광고 테이블 입력 단에서 — filteredAds 에 추가.

  // Concurrent collections — keyed by query keyword. Each entry tracks its
  // own logs / progress / busy flag so multiple ATC scrapes (and a YouTube
  // search) can run in parallel without stepping on each other.
  type AdCollection = {
    busy: boolean;
    logs: LogLine[];
    progress: { step: string; percent: number };
  };
  const [adCollections, setAdCollections] = useState<
    Record<string, AdCollection>
  >({});
  const adESRefs = useRef<Map<string, EventSource>>(new Map());

  // Single YouTube search at a time (lighter operation, not SSE)
  const [busyYt, setBusyYt] = useState<string | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);

  const currentCollection = selectedKeyword
    ? adCollections[selectedKeyword]
    : null;
  const isBusyKeyword = (kw: string) => adCollections[kw]?.busy ?? false;
  const anyBusyAds = Object.values(adCollections).some((c) => c.busy);

  // Auto-scroll the visible log to bottom whenever its log array grows.
  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [currentCollection?.logs]);

  const refreshAll = async () => {
    // 각 API 도착 즉시 setState — Promise.all 로 다 끝날 때까지 기다리던
    // 이전 방식은 가장 느린 fetch (1~2초) 까지 사이드바도 빈 채. 분리해서
    // jobs/watch (사이드바 핵심) 가 0.4초에 오면 즉시 채워짐. progressive
    // UI = 사용자가 데이터 들어오는 게 보임 → "빈 화면 13초" 사라짐.
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs ?? []))
      .catch(() => {});
    fetch("/api/watch")
      .then((r) => r.json())
      .then((d) => {
        const ws: Watch[] = d.watches ?? [];
        setWatches(ws);
        // DB tags → tagMap 병합. DB 가 source of truth (팀 공유), 로컬에만
        // 있는 태그는 서버로 1회 마이그레이션 (localStorage 시절 잔존분).
        setTagMap((local) => {
          const merged: Record<string, string[]> = { ...local };
          for (const w of ws) {
            const dbTags = parseTags(w.tags);
            if (dbTags.length > 0) merged[w.keyword] = dbTags;
          }
          // 로컬에만 있고 DB 에 없는 keyword → 서버 push (마이그레이션)
          for (const [kw, tags] of Object.entries(local)) {
            const w = ws.find((x) => x.keyword === kw && x.kind === "ad");
            if (w && parseTags(w.tags).length === 0 && tags.length > 0) {
              void fetch("/api/watch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ keyword: kw, kind: "ad", tags }),
              }).catch(() => {});
            }
          }
          return merged;
        });
      })
      .catch(() => {});
    fetch("/api/meta-watch")
      .then((r) => r.json())
      .then((d) => setMetaWatches(d.watches ?? []))
      .catch(() => {});
    fetch("/api/meta/list")
      .then((r) => r.json())
      .then((d) => setMetaJobs(d.jobs ?? []))
      .catch(() => {});
    fetch("/api/videos")
      .then((r) => r.json())
      .then((d) => setVideos(d.videos ?? []))
      .catch(() => {});
    // 첫 fetch — stats 없이 가볍게. 가장 큰 응답이라 가장 마지막에 도착할
    // 수 있어서 다른 데이터와 분리해 둔다.
    //
    // limit 은 savedAt desc 로 자르기 때문에 너무 낮으면 "마지막에 수집한
    // 광고주 한 곳"만 로드돼서 상단 광고주/채널 필터에 그 한 곳만 뜬다
    // (300 일 때 실제로 그랬다). 무거운 건 여기가 아니라 뒤따르는
    // /api/ad-stats 병합이고 그건 이미 지연 로드라, 목록 자체는 넉넉히
    // 받는 편이 낫다. 측정: 4.5k건 withStats=false = 4.2MB raw /
    // gzip 약 700KB / 0.17s.
    fetch(`/api/ads?withStats=false&limit=${INITIAL_ADS_LIMIT}`)
      .then((r) => r.json())
      .then((d) => setAds(d.ads ?? []))
      .catch(() => {});
    // stats 백그라운드 fetch — 5초 지연 + requestIdleCallback 으로 main
    // thread block 회피. 사용자가 본 30초 "응답 없음" 다이얼로그 진짜 원인:
    // 4000 ads × 30일 stats merge + 그 직후 useMemo (groupedAds/filteredAds/
    // sortedAds) 4000개 재계산 + AdsTable re-render 가 모두 main thread block.
    // - 5초 지연 → 첫 paint 후 사용자 인터랙션 안정될 때 시작
    // - requestIdleCallback → 브라우저가 idle 한 frame에 처리
    setTimeout(() => {
      const start = () => {
        fetch("/api/ad-stats")
          .then((r) => r.json())
          .then((d: { stats: Record<string, AdStat[]> }) => {
            setAds((prev) =>
              prev.map((a) => ({
                ...a,
                stats: d.stats[a.creativeId] ?? a.stats ?? [],
              }))
            );
          })
          .catch(() => {});
      };
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        (window as Window & {
          requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void;
        }).requestIdleCallback(start, { timeout: 10000 });
      } else {
        start();
      }
    }, 5000);
  };

  const isWatched = (keyword: string, kind: string) =>
    watches.some(
      (w) => w.keyword === keyword && w.kind === kind && w.active
    );

  const watchInfo = (keyword: string, kind: string): Watch | null =>
    watches.find((w) => w.keyword === keyword && w.kind === kind) ?? null;

  const toggleWatch = async (keyword: string, kind: string) => {
    await fetch("/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, kind }),
    });
    await refreshAll();
  };

  // A1/A2/A3 중요도 그룹 — 카드의 tier dot 클릭 시 A1→A2→A3→없음 cycle.
  // 서버 저장 후 watches 만 재로드 (가볍게).
  const cycleTier = async (keyword: string) => {
    const w = watches.find((x) => x.keyword === keyword && x.kind === "ad");
    const cur = w?.tier ?? null;
    const next = TIER_CYCLE[(TIER_CYCLE.indexOf(cur) + 1) % TIER_CYCLE.length];
    await fetch("/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, kind: "ad", tier: next }),
    }).catch(() => {});
    const d = await fetch("/api/watch").then((r) => r.json()).catch(() => null);
    if (d?.watches) setWatches(d.watches);
  };
  // tier 필터 — 사이드바 상단 chip. null=전체.
  const [tierFilter, setTierFilter] = useState<string | null>(null);

  // 매일/격일 티어 토글. daily 만 변경(active 유지). 격일이 기본이라
  // 중요 brand 만 매일로 올려 IPRoyal 트래픽을 아낀다.
  const toggleDaily = async (keyword: string, kind: string, next: boolean) => {
    await fetch("/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, kind, daily: next }),
    });
    await refreshAll();
  };

  useEffect(() => {
    refreshAll()
      .catch(() => {})
      .finally(() => setLoaded(true));
    const refs = adESRefs.current;
    return () => {
      refs.forEach((es) => es.close());
      refs.clear();
    };
  }, []);

  const updateCollection = (
    keyword: string,
    fn: (c: AdCollection) => AdCollection
  ) => {
    setAdCollections((prev) => {
      const cur = prev[keyword] ?? {
        busy: false,
        logs: [],
        progress: { step: "", percent: 0 },
      };
      return { ...prev, [keyword]: fn(cur) };
    });
  };

  const startAdCollection = (q: string, opts?: { snapshot?: boolean }) => {
    if (!q || isBusyKeyword(q)) return;

    // Initialize fresh state for this keyword
    setAdCollections((prev) => ({
      ...prev,
      [q]: {
        busy: true,
        logs: [],
        progress: { step: "starting", percent: 0 },
      },
    }));
    setSelectedKeyword(q);
    setTab("ads");

    // snapshot=1 → 서버가 Watch upsert skip = cron 미편입 (1회 조사만).
    const es = new EventSource(
      `/api/ads-stream?query=${encodeURIComponent(q)}${
        opts?.snapshot ? "&snapshot=1" : ""
      }`
    );
    adESRefs.current.set(q, es);

    es.addEventListener("job", () => {
      // Job row created in DB — refresh sidebar so 진행 중 entry appears
      void refreshAll();
    });

    es.addEventListener("log", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as {
          msg: string;
          level: LogLevel;
        };
        updateCollection(q, (c) => ({
          ...c,
          logs: [...c.logs, { time: new Date(), msg: d.msg, level: d.level }],
        }));
      } catch {}
    });

    es.addEventListener("progress", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as {
          step: string;
          percent: number;
        };
        updateCollection(q, (c) => ({ ...c, progress: d }));
      } catch {}
    });

    const finish = () => {
      updateCollection(q, (c) => ({ ...c, busy: false }));
      adESRefs.current.delete(q);
      void refreshAll();
    };

    es.addEventListener("done", () => {
      es.close();
      finish();
    });

    es.addEventListener("error", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data ?? "{}") as {
          message?: string;
        };
        if (d.message) {
          updateCollection(q, (c) => ({
            ...c,
            logs: [
              ...c.logs,
              { time: new Date(), msg: `❌ ${d.message}`, level: "error" },
            ],
          }));
        }
      } catch {
        // native error event (conn closed). Already finishing below.
      }
      es.close();
      finish();
    });
  };

  // 📸 스냅샷 모드 — 체크하면 이번 검색은 추적(Watch/cron) 미편입, 1회
  // 조사만. 신규 brand 발굴 시 트래픽 절약 (레퍼런스 도구 벤치마크 2026-07-13).
  const [snapshotMode, setSnapshotMode] = useState(false);

  const runAdSearch = () => {
    const raw = adQuery.trim();
    if (!raw || isBusyKeyword(raw)) return;
    setAdQuery("");
    // Multi-keyword 분리 — placeholder에 "example.co.kr, example-shop.com, 쿠팡"
    // 처럼 콤마로 여러 brand 한 번에 가능. 각 keyword를 구글 + 메타 둘 다
    // 동시에 큐에 넣어서 한 검색으로 두 플랫폼 데이터 쌓이게.
    const keywords = raw
      .split(/[,\n]+/)
      .map((k) => k.trim())
      .filter(Boolean);
    for (const kw of keywords) {
      // 구글 ATC 만 자동 수집. 메타는 트래픽 ~200MB/회 ($0.35) 라 검색
      // 시 자동 트리거 금지 — 사용자가 사이드바 brand 🔄 로 명시적으로
      // 수집해야 비용이 통제된다. (검색하면 구글 결과 뜬 뒤 메타 brand
      // 카드가 사이드바에 등록되니, 거기서 🔄 누르면 수집)
      if (!isBusyKeyword(kw))
        startAdCollection(kw, { snapshot: snapshotMode });
    }
  };

  const refreshJob = async (keyword: string, kind: string) => {
    // 무료 배포판은 광고(ad) job 만 다룬다.
    if (kind === "ad") startAdCollection(keyword);
  };

  const clearAll = async () => {
    // 전체 데이터 삭제는 관리자 전용. Codex 인앱 브라우저는 window.prompt를
    // 지원하지 않으므로 사이드바의 비밀번호 입력칸에서 받은 값을 전달한다.
    const secret = deleteSecret.trim();
    if (!secret || deletingAll) return;
    setDeletingAll(true);
    setDeleteError(null);
    setDeleteDone(false);
    const headers = { "x-admin-secret": secret };
    try {
      const adsRes = await fetch("/api/ads", { method: "DELETE", headers });
      if (adsRes.status === 403) {
        setDeleteError("비밀번호가 틀렸습니다. 삭제가 취소되었습니다.");
        return;
      }
      if (!adsRes.ok) {
        setDeleteError(`삭제 실패 (${adsRes.status}). 다시 시도하세요.`);
        return;
      }
      await fetch("/api/videos", { method: "DELETE", headers });
      setJobs([]);
      setVideos([]);
      setAds([]);
      setSelectedKeyword(null);
      setDeleteSecret("");
      setDeleteOpen(false);
      setDeleteDone(true);
    } finally {
      setDeletingAll(false);
    }
  };

  const scopedAds = useMemo(
    () =>
      selectedKeyword ? ads.filter((a) => a.keyword === selectedKeyword) : ads,
    [ads, selectedKeyword]
  );
  const scopedVideos = useMemo(
    () =>
      selectedKeyword
        ? videos.filter((v) => v.keyword === selectedKeyword)
        : videos,
    [videos, selectedKeyword]
  );

  const filteredAds = useMemo(() => {
    return scopedAds.filter((a) => {
      if (adTypeFilter === "youtube") {
        if (!a.youtubeId) return false;
      } else if (adTypeFilter !== "all" && a.type !== adTypeFilter) {
        return false;
      }
      if (filter === "hero" && (a.ytViews ?? 0) < 500_000) return false;
      if (filter === "growing") {
        const v = a.ytViews ?? 0;
        const dpd = dailyViews(a.ytViews, a.ytPublishedAt);
        if (v < 100_000 && dpd < 3_000) return false;
      }
      // 상태 분류 필터 (classifyAd 결과에 선택된 라벨이 포함되어야 함)
      if (classFilter !== "all") {
        const cs = classifyAd(a);
        if (!cs.includes(classFilter)) return false;
      }
      // 스냅샷 타임라인 필터 — sinceDateFilter 클릭 시 그 날 이후
      // ATC firstSeen 인 광고만 통과.
      if (sinceDateFilter) {
        if (!a.firstSeen) return false;
        const t = parseInt(a.firstSeen, 10) * 1000;
        if (isNaN(t) || t < new Date(sinceDateFilter).getTime()) return false;
      }
      // 🎯 이 도메인만 — Stage3 형제 brand 제거. Stage1 으로 명확히 표시된
      // 광고만. via=null (레거시) 도 같이 빠짐.
      if (domainOnly && a.via !== "domain") return false;
      // 채널 chip — 선택된 채널 중 하나라도 매칭되어야 통과.
      if (selectedChannels.size > 0) {
        const ch = a.ytChannel || a.advertiserName || "";
        if (!selectedChannels.has(ch)) return false;
      }
      // 조회수 대역 — "min:max" (max 빈 문자열 = 무한). YouTube 매칭
      // 안 된 광고 (ytViews null) 는 대역 필터 켜면 제외.
      if (viewBand) {
        const [minS, maxS] = viewBand.split(":");
        const v = a.ytViews;
        if (v == null) return false;
        if (minS && v < parseInt(minS, 10)) return false;
        if (maxS && v >= parseInt(maxS, 10)) return false;
      }
      // 소재 나이 — "old:N" = firstSeen 이 N일 이상 지났고 아직 수집되는
      // (=살아있는) 광고. 롱런/스테디셀러 = 오래 살아남은 검증된 소재.
      if (ageBand.startsWith("old:")) {
        const minDays = parseInt(ageBand.slice(4), 10);
        if (!a.firstSeen) return false;
        const ageDays =
          (Date.now() - parseInt(a.firstSeen, 10) * 1000) / 86400000;
        if (ageDays < minDays) return false;
      }
      // 결과 내 검색 — 제목/채널/광고주명 contains. brand 가 섞여 나올 때
      // "브랜드D" / "브랜드E" 등으로 좁히는 용도. 공백 무시 + 대소문자 무시.
      if (innerSearch.trim()) {
        const q = innerSearch.trim().toLowerCase();
        const hay = [
          a.ytTitle,
          a.ytChannel,
          a.advertiserName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scopedAds, adTypeFilter, filter, classFilter, sinceDateFilter, innerSearch, selectedChannels, domainOnly, viewBand, ageBand]);

  // 도메인 검색 결과인지 — via 가 한 개라도 채워져 있으면 도메인 모드 검색
  // 결과. 이름 검색 ("쿠팡") 결과에는 via 가 다 null 이라 토글이 의미 X →
  // 그때만 토글 숨김.
  const hasDomainModeAds = useMemo(
    () => scopedAds.some((a) => a.via === "domain" || a.via === "advertiser"),
    [scopedAds]
  );
  const domainAdsCount = useMemo(
    () => scopedAds.filter((a) => a.via === "domain").length,
    [scopedAds]
  );

  // 채널 chip 명단 — scopedAds (filter 거치기 전) 기준으로 unique 채널 +
  // 광고 갯수. 2개 이상일 때만 row 표시 (1개면 chip 의미 없음). 갯수 desc.
  const channelChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of scopedAds) {
      const ch = a.ytChannel || a.advertiserName || "";
      if (!ch) continue;
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [scopedAds]);

  const sortedAds = useMemo(() => {
    const dir = sortDir === "desc" ? -1 : 1;
    const getVal = (a: Ad): number => {
      switch (sortKey) {
        case "views":
          return a.ytViews ?? -1;
        case "daily":
          return dailyViews(a.ytViews, a.ytPublishedAt);
        case "date":
          return adDate(a);
        case "likes":
          return a.ytLikes ?? -1;
        case "comments":
          return a.ytComments ?? -1;
        case "delta":
          return viewsChange(a, analyzeDays).delta;
        case "growth":
          return viewsChange(a, analyzeDays).percent;
        case "status":
          return statusRank(a);
      }
    };
    // 데이터 없는 행은 정렬 방향과 무관하게 항상 맨 아래로 (nulls-last).
    // 성장률/변화는 스냅샷 2개+ 없으면 "—", 상태는 분류 신호 없으면 "일반".
    // 이걸 0 으로 처리하면 음수 성장(-50%)보다 위로 와서 직관에 어긋남.
    const hasVal = (a: Ad): boolean => {
      switch (sortKey) {
        case "growth":
        case "delta":
          return viewsChange(a, analyzeDays).hasData;
        case "status":
          return classifyAd(a).length > 0;
        case "likes":
          return a.ytLikes != null;
        case "comments":
          return a.ytComments != null;
        case "views":
          return a.ytViews != null;
        default:
          return true;
      }
    };
    return [...filteredAds].sort((a, b) => {
      const aHas = hasVal(a);
      const bHas = hasVal(b);
      if (aHas !== bHas) return aHas ? -1 : 1; // 데이터 있는 행 우선
      return dir * (getVal(a) - getVal(b));
    });
  }, [filteredAds, sortKey, sortDir, analyzeDays]);

  // Deduplicate ads by youtubeId so the same YouTube video doesn't appear
  // multiple times when used as multiple ad creatives. Each group keeps
  // the first (highest-priority by current sort) ad, plus the count of
  // sibling ad creatives sharing the same YouTube video.
  type AdGroup = { primary: Ad; siblings: Ad[]; count: number };
  const groupedAds = useMemo<AdGroup[]>(() => {
    const ytGroups = new Map<string, AdGroup>();
    const noYt: AdGroup[] = [];
    for (const ad of sortedAds) {
      if (ad.youtubeId) {
        const existing = ytGroups.get(ad.youtubeId);
        if (existing) {
          existing.siblings.push(ad);
          existing.count = existing.siblings.length;
        } else {
          ytGroups.set(ad.youtubeId, { primary: ad, siblings: [ad], count: 1 });
        }
      } else {
        noYt.push({ primary: ad, siblings: [ad], count: 1 });
      }
    }
    return [...ytGroups.values(), ...noYt];
  }, [sortedAds]);

  const filteredVideos = useMemo(() => {
    return scopedVideos.filter((v) => {
      if (filter === "hero") return v.views >= 500_000;
      if (filter === "growing") return v.views >= 100_000;
      return true;
    });
  }, [scopedVideos, filter]);

  // YouTube tab uses the same sortKey/sortDir state as the ads tab,
  // so 조회수/좋아요/댓글/게시일 sort works in both places.
  const sortedVideos = useMemo(() => {
    const dir = sortDir === "desc" ? -1 : 1;
    const getVal = (v: Video): number => {
      switch (sortKey) {
        case "views":
          return v.views ?? 0;
        case "daily": {
          // YouTube videos table doesn't display 회/일, but sort key shared
          // across tabs — fall back to views for stability.
          if (!v.publishedAt) return 0;
          const days = Math.max(
            1,
            Math.floor(
              (Date.now() - new Date(v.publishedAt).getTime()) / 86400000
            )
          );
          return Math.floor(v.views / days);
        }
        case "date": {
          if (!v.publishedAt) return 0;
          const t = new Date(v.publishedAt).getTime();
          return isNaN(t) ? 0 : t;
        }
        case "likes":
          return v.likes ?? 0;
        case "comments":
          return v.comments ?? 0;
        case "delta":
        case "growth":
        case "status":
          // YouTube videos don't track AdStat snapshots / 상태 분류 —
          // fall back to views so sort stays stable when user clicks
          // 변화/성장률/상태 header on YT tab (shared sortKey across tabs).
          return v.views ?? 0;
      }
    };
    return [...filteredVideos].sort((a, b) => dir * (getVal(a) - getVal(b)));
  }, [filteredVideos, sortKey, sortDir]);

  const advertiserGroups = useMemo(() => {
    const map = new Map<string, { name: string; id: string; count: number }>();
    for (const a of scopedAds) {
      const k = a.advertiserId;
      const prev = map.get(k);
      if (prev) prev.count += 1;
      else map.set(k, { name: a.advertiserName, id: a.advertiserId, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [scopedAds]);

  /**
   * 브랜드 아카이브 카드 데이터. 서버(/api/archive)에서 keyword 단위로
   * 집계해서 받는다 — 목록 fetch 는 limit 에 걸리기 때문에 그걸로 세면
   * 카드의 "N개 게재 중" 이 실제보다 작게 나온다.
   */
  const [archiveBrands, setArchiveBrands] = useState<ArchiveBrand[]>([]);
  const loadArchive = useCallback(() => {
    fetch("/api/archive")
      .then((r) => r.json())
      .then((d: { brands?: ArchiveBrand[] }) => setArchiveBrands(d.brands ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadArchive();
  }, [loadArchive]);
  // 수집이 끝나면(= job 목록이 바뀌면) 카드 숫자도 따라 갱신.
  useEffect(() => {
    loadArchive();
  }, [jobs.length, loadArchive]);

  // Cross-domain creative pool (소재 분석): ALL collected ads with YouTube
  // data — this tab's whole point is comparing across domains, so it
  // intentionally ignores selectedKeyword. Use the per-tab advertiser
  // filter chip below if you want to scope to one domain.
  const [creativeDomainFilter, setCreativeDomainFilter] = useState<
    string | null
  >(null);
  const creativePool = useMemo(() => {
    const byYt = new Map<
      string,
      { primary: Ad; siblings: Ad[]; count: number }
    >();
    const source = creativeDomainFilter
      ? ads.filter((a) => a.keyword === creativeDomainFilter)
      : ads;
    for (const ad of source) {
      if (!ad.youtubeId) continue;
      const ex = byYt.get(ad.youtubeId);
      if (ex) {
        ex.siblings.push(ad);
        ex.count++;
      } else {
        byYt.set(ad.youtubeId, { primary: ad, siblings: [ad], count: 1 });
      }
    }
    const rows = Array.from(byYt.values());
    const dir = creativesSortDir === "desc" ? -1 : 1;
    const getVal = (g: { primary: Ad; count: number }): number => {
      const a = g.primary;
      switch (creativesSort) {
        case "views":
          return a.ytViews ?? 0;
        case "daily":
          return dailyViews(a.ytViews, a.ytPublishedAt);
        case "date": {
          if (!a.ytPublishedAt) return 0;
          const t = new Date(a.ytPublishedAt).getTime();
          return isNaN(t) ? 0 : t;
        }
        case "likes":
          return a.ytLikes ?? 0;
        case "comments":
          return a.ytComments ?? 0;
        case "campaigns":
          return g.count;
      }
    };
    rows.sort((a, b) => dir * (getVal(a) - getVal(b)));
    return rows;
  }, [ads, creativeDomainFilter, creativesSort, creativesSortDir]);

  // List of domains we have ads for (for the per-tab domain filter)
  const allAdDomains = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of ads) {
      if (!a.youtubeId) continue;
      counts.set(a.keyword, (counts.get(a.keyword) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count);
  }, [ads]);

  const toggleCreativesSort = (key: CreativesSort) => {
    if (creativesSort === key) {
      setCreativesSortDir(creativesSortDir === "desc" ? "asc" : "desc");
    } else {
      setCreativesSort(key);
      setCreativesSortDir("desc");
    }
  };

  type GroupedJob = {
    keyword: string;
    kind: string;
    status: string;
    errorMsg?: string | null;
    videoCount: number;
    adCount: number;
    latestAt: string;
  };
  // Group by (keyword, kind) so ads-tab jobs and youtube-tab jobs stay separate.
  // Both 광고 수집 and 소재 분석 tabs work with ad data, so they share
  // the same set of ad jobs in the sidebar; YouTube tab gets its own.
  const groupedJobs = useMemo<GroupedJob[]>(() => {
    // 무료 배포판은 광고(ad) job 만 다룬다.
    const tabKind = "ad";
    const tabJobs = jobs.filter((j) => j.kind === tabKind);
    const map = new Map<string, GroupedJob>();
    for (const job of tabJobs) {
      const key = `${job.kind}::${job.keyword}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          keyword: job.keyword,
          kind: job.kind,
          status: job.status,
          errorMsg: job.errorMsg ?? null,
          videoCount: job.resultCount,
          adCount: job.adCount,
          latestAt: job.createdAt,
        });
      } else {
        const newer =
          new Date(job.createdAt) > new Date(prev.latestAt) ? job : null;
        map.set(key, {
          ...prev,
          videoCount: Math.max(prev.videoCount, job.resultCount),
          adCount: Math.max(prev.adCount, job.adCount),
          status: newer?.status ?? prev.status,
          errorMsg: newer?.errorMsg ?? prev.errorMsg,
          latestAt:
            new Date(job.createdAt) > new Date(prev.latestAt)
              ? job.createdAt
              : prev.latestAt,
        });
      }
    }
    return Array.from(map.values())
      .filter((g) => {
        // Hide jobs that found 0 results AND aren't currently running.
        // (Avoid sidebar clutter from failed-search domains like grannysalad
        // that have nothing to show.)
        if (adCollections[g.keyword]?.busy) return true;
        return g.adCount > 0 || g.videoCount > 0;
      })
      .sort(
        (a, b) =>
          new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
      );
  }, [jobs, tab, adCollections]);

  // Meta brand groups for the sidebar — collapse all sock-puppet pages
  // (page:* watches) under their anchor brand so 덱카닉 et al. show up
  // even when no ATC ads exist for them. Uses anchorKeyword from
  // MetaWatch when available; falls back to grouping by the keyword
  // itself for legacy rows whose Prisma client predates the migration.
  type MetaBrandGroup = {
    anchor: string;
    keywords: string[];
    pageWatches: number;
    autoCount: number;
    manualCount: number;
    seedCount: number;
    adCount: number;
    pageCount: number;
    latestAt: string | null;
    runningCount: number;
    erroredCount: number;
  };

  /**
   * 자동수집 현황 — 활성 Watch들 중 최근 24시간 안에 launchd cron이 돌았고
   * 마지막 실행이 '완료'면 성공으로 카운트. 레퍼런스 대시보드의
   * "오늘 자동수집 N/M (X%) · 누락 K개" 위젯과 동일한 인사이트.
   *
   * Worker는 read-only라 "복구" 버튼은 keyword를 검색 입력에 채워주는
   * 식으로 동작 — 사용자가 로컬 dev에서 실제 재수집을 한 번 트리거하거나,
   * 다음 새벽 3시 자동 cron이 처리.
   */
  const autoCollectStatus = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const active = watches.filter((w) => w.active);
    // 메타 cron 은 비활성(수동 전용, scripts/run-tracked.ts 의
    // META_CRON_ENABLED 참고). 수동으로만 수집하므로 메타 watch 를
    // "누락"으로 카운트하면 모순 — 자동수집 현황은 구글 watch
    // (prisma.watch / kind="ad") 기준으로만 집계한다.
    type WLite = {
      keyword: string;
      lastRunAt: string | null;
      lastRunStatus: string | null;
      source: "google" | "meta";
    };
    const all: WLite[] = [
      ...active.map<WLite>((w) => ({
        keyword: w.keyword,
        lastRunAt: w.lastRunAt ?? null,
        lastRunStatus: w.lastRunStatus ?? null,
        source: "google",
      })),
    ];
    const total = all.length;
    const wasRecent = (lastRunAt: string | null) => {
      if (!lastRunAt) return false;
      const t = new Date(lastRunAt).getTime();
      return !isNaN(t) && t >= cutoff;
    };
    const success = all.filter(
      (w) => wasRecent(w.lastRunAt) && w.lastRunStatus === "완료"
    ).length;
    const failed = all.filter(
      (w) => wasRecent(w.lastRunAt) && w.lastRunStatus === "실패"
    );
    const notRun = all.filter((w) => !wasRecent(w.lastRunAt));
    const missing = [...failed, ...notRun];
    return {
      total,
      success,
      failedCount: failed.length,
      notRunCount: notRun.length,
      missingCount: missing.length,
      successRate: total > 0 ? Math.round((success / total) * 100) : 0,
      missing: missing.map((w) => ({
        keyword: w.keyword,
        source: w.source,
        reason: w.lastRunStatus === "실패" ? "실패" : "미실행",
      })),
    };
  }, [watches]);

  /**
   * 광고주 순위 — selectedKeyword 가 있을 때, 내가 추적 중인 모든 keyword
   * 들 사이에서 이 keyword가 차지하는 위치 (소재수 + 가속도 두 축).
   *
   * 레퍼런스 대시보드 "내가 추적 중인 24개 업체 중 이 광고주 위치 / 광고
   * 소재수 N위/24 / 가속도 N위/24" 패널과 동일 인사이트. 광고주끼리 상대
   * 비교가 강력함 — "지금 빠르게 늘고 있는 광고주가 누군지" 한 눈에.
   *
   * 가속도 = analyzeDays 기간 동안 그 keyword 광고들의 평균 avgPerDay
   * (viewsChange 결과). 데이터 부족한 keyword는 0 처리.
   */
  const advertiserRanking = useMemo(() => {
    if (!selectedKeyword) return null;
    const keywords = Array.from(
      new Set([
        ...ads.map((a) => a.keyword),
        ...jobs.filter((j) => j.kind === "ad").map((j) => j.keyword),
      ])
    );
    if (keywords.length === 0) return null;
    type Row = { keyword: string; adCount: number; avgAccel: number };
    const stats: Row[] = keywords.map((kw) => {
      const kwAds = ads.filter((a) => a.keyword === kw);
      let sum = 0;
      let n = 0;
      for (const a of kwAds) {
        const c = viewsChange(a, analyzeDays);
        if (c.hasData) {
          sum += c.avgPerDay;
          n++;
        }
      }
      return {
        keyword: kw,
        adCount: kwAds.length,
        avgAccel: n > 0 ? Math.floor(sum / n) : 0,
      };
    });
    const byAdCount = [...stats].sort((a, b) => b.adCount - a.adCount);
    const byAccel = [...stats].sort((a, b) => b.avgAccel - a.avgAccel);
    const adRank =
      byAdCount.findIndex((s) => s.keyword === selectedKeyword) + 1;
    const accelRank =
      byAccel.findIndex((s) => s.keyword === selectedKeyword) + 1;
    const self = stats.find((s) => s.keyword === selectedKeyword);
    if (!self) return null;
    return {
      total: stats.length,
      adRank,
      accelRank,
      adCount: self.adCount,
      avgAccel: self.avgAccel,
      adRankPercent:
        stats.length > 0
          ? Math.round(((stats.length - adRank + 1) / stats.length) * 100)
          : 0,
      accelRankPercent:
        stats.length > 0
          ? Math.round(
              ((stats.length - accelRank + 1) / stats.length) * 100
            )
          : 0,
    };
  }, [selectedKeyword, ads, jobs, analyzeDays]);

  const metaBrandGroups = useMemo<MetaBrandGroup[]>(() => {
    // Pull the latest job per keyword.
    const latestByKeyword = new Map<string, MetaJobRow>();
    for (const j of metaJobs) {
      const prev = latestByKeyword.get(j.keyword);
      if (!prev || new Date(j.createdAt) > new Date(prev.createdAt)) {
        latestByKeyword.set(j.keyword, j);
      }
    }

    const groups = new Map<string, MetaBrandGroup>();
    const ensure = (anchor: string) => {
      let g = groups.get(anchor);
      if (!g) {
        g = {
          anchor,
          keywords: [],
          pageWatches: 0,
          autoCount: 0,
          manualCount: 0,
          seedCount: 0,
          adCount: 0,
          pageCount: 0,
          latestAt: null,
          runningCount: 0,
          erroredCount: 0,
        };
        groups.set(anchor, g);
      }
      return g;
    };

    // 1) Seed groups from MetaWatch — every active watch contributes,
    //    even if it never ran. Anchor falls back to keyword for rows
    //    missing anchorKeyword (legacy / pre-migration response).
    for (const w of metaWatches) {
      if (!w.active) continue;
      const isPage = w.keyword.startsWith("page:");
      const anchor = w.anchorKeyword || (isPage ? w.keyword : w.keyword);
      const g = ensure(anchor);
      g.keywords.push(w.keyword);
      if (isPage) g.pageWatches += 1;
      if (w.source === "auto") g.autoCount += 1;
      else if (w.source === "manual") g.manualCount += 1;
      else if (w.source === "seed") g.seedCount += 1;
    }

    // 2) Fold in latest job stats per keyword (ad count, status, time).
    for (const g of groups.values()) {
      for (const kw of g.keywords) {
        const j = latestByKeyword.get(kw);
        if (!j) continue;
        g.adCount += j.adCount;
        g.pageCount += j.pageCount;
        if (j.status === "in_progress" || j.status === "queued") {
          g.runningCount += 1;
        } else if (j.status === "error") {
          g.erroredCount += 1;
        }
        if (
          !g.latestAt ||
          new Date(j.createdAt) > new Date(g.latestAt)
        ) {
          g.latestAt = j.createdAt;
        }
      }
    }

    // 3) Catch any keyword that has jobs but no MetaWatch row — show
    //    it as its own anchor so the user sees orphaned runs too.
    for (const [kw, j] of latestByKeyword.entries()) {
      const watched = metaWatches.some((w) => w.keyword === kw);
      if (watched) continue;
      const g = ensure(kw);
      if (!g.keywords.includes(kw)) g.keywords.push(kw);
      g.adCount += j.adCount;
      g.pageCount += j.pageCount;
      if (j.status === "in_progress" || j.status === "queued") {
        g.runningCount += 1;
      } else if (j.status === "error") {
        g.erroredCount += 1;
      }
      if (!g.latestAt || new Date(j.createdAt) > new Date(g.latestAt)) {
        g.latestAt = j.createdAt;
      }
    }

    return Array.from(groups.values()).sort((a, b) => {
      // Currently-running brands float to the top so the user can
      // watch progress without scrolling.
      if (a.runningCount !== b.runningCount) {
        return b.runningCount - a.runningCount;
      }
      if (a.adCount !== b.adCount) return b.adCount - a.adCount;
      const at = a.latestAt ? new Date(a.latestAt).getTime() : 0;
      const bt = b.latestAt ? new Date(b.latestAt).getTime() : 0;
      return bt - at;
    });
  }, [metaWatches, metaJobs]);

  const totalAds = scopedAds.length;
  const totalEligible = useMemo(
    () => scopedAds.filter((a) => a.type === "video" || a.type === "other").length,
    [scopedAds]
  );
  const totalMatched = useMemo(
    () => scopedAds.filter((a) => a.youtubeId).length,
    [scopedAds]
  );
  const totalAdVideos = useMemo(() => {
    const yt = new Set(
      scopedAds.map((a) => a.youtubeId).filter(Boolean) as string[]
    );
    return yt.size;
  }, [scopedAds]);

  const downloadJSON = () => {
    const data = sortedAds;
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tab}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCSV = () => {
    const escape = (v: string | number | null | undefined) => {
      const s = String(v ?? "").replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    let csv = "";
    if (tab === "ads") {
      const headers = [
        "#",
        "광고주",
        "제목(YouTube)",
        "유형",
        "게시일",
        "조회수",
        "회/일",
        "좋아요",
        "댓글",
        "ATC URL",
        "YouTube URL",
      ];
      csv = [
        headers.join(","),
        ...sortedAds.map((a, i) =>
          [
            i + 1,
            a.advertiserName,
            a.ytTitle ?? "",
            a.type,
            a.ytPublishedAt ?? formatUnixDate(a.firstSeen),
            a.ytViews ?? 0,
            dailyViews(a.ytViews, a.ytPublishedAt),
            a.ytLikes ?? 0,
            a.ytComments ?? 0,
            atcLink(a),
            a.youtubeId ? ytLink(a.youtubeId) : "",
          ]
            .map(escape)
            .join(",")
        ),
      ].join("\n");
    }
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tab}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 현재 보이는(필터·정렬 적용) 광고의 YouTube 링크를 "브랜드 | URL" 한 줄씩 복사.
  // 같은 영상이 크리에이티브 여러 개에 걸려 있으면 한 번만. ad-factory
  // refs/inbox/list.txt 에 그대로 붙여넣는 용도.
  const copyLinks = async () => {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const a of sortedAds) {
      if (!a.youtubeId || seen.has(a.youtubeId)) continue;
      seen.add(a.youtubeId);
      lines.push(`${a.keyword} | ${ytLink(a.youtubeId)}`);
    }
    if (lines.length === 0) return;
    await navigator.clipboard.writeText(lines.join("\n") + "\n");
    setCopiedCount(lines.length);
    setTimeout(() => setCopiedCount(null), 2000);
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const formatRelative = (iso: string) => {
    try {
      const d = new Date(iso);
      const diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return "방금";
      if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
      return `${Math.floor(diff / 86400)}일 전`;
    } catch {
      return iso;
    }
  };

  const isDomainHint = adQuery.trim() && looksLikeDomain(adQuery.trim());

  const toggleSort = (key: AdSortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="flex min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* 태그 input 자동완성 — 기존에 라벨링된 태그들 suggest */}
      <datalist id="known-tags">
        {allTags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {/* 아이콘 레일 — 최상위 이동. 레이블은 툴팁으로만 (폭 절약). */}
      <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-[#2b3141] bg-[#20242f] py-3">
        <span
          aria-hidden
          className="mb-2 grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 text-sm font-black text-white shadow-lg shadow-blue-500/25"
        >
          S
        </span>
        {(
          [
            ["archive", "🗂", "브랜드 아카이브"],
            ["ads", "📋", "구글 광고 (YouTube 영상)"],
            ["meta", "📘", "메타 광고"],
            ["creatives", "🎬", "소재 비교"],
            ["dashboard", "📊", "대시보드"],
            ["guide", "❓", "사용법"],
          ] as const
        ).map(([key, icon, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            title={label}
            aria-label={label}
            aria-current={tab === key ? "page" : undefined}
            className={`grid h-10 w-10 place-items-center rounded-xl text-lg transition ${
              tab === key
                ? "bg-blue-500/20 text-blue-200"
                : "text-slate-400 hover:bg-[#2b3141] hover:text-slate-100"
            }`}
          >
            {icon}
          </button>
        ))}
      </nav>

      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-[#2b3141] bg-[#20242f] [--accent-soft:rgba(96,165,250,0.16)] [--bg-base:#20242f] [--bg-card:#2a2f3b] [--bg-elev:#242936] [--border-strong:#465166] [--border:#343b4c] [--shadow-card:none] [--text-muted:#94a3b8] [--text-primary:#f8fafc] [--text-secondary:#cbd5e1]">
        <div className="px-5 pb-4 pt-6">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 text-sm font-black text-white shadow-lg shadow-blue-500/25">S</span>
            <div>
              <div className="text-[17px] font-extrabold tracking-tight text-white">Success AI</div>
              <div className="mt-0.5 text-[13px] font-medium text-slate-300">광고 레퍼런스를 모으는 곳</div>
            </div>
          </div>
        </div>

        <div className="border-b border-[#2b3141] px-3 pb-4">
          <label htmlFor="app-switcher" className="mb-2 block px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            앱 선택
          </label>
          <details className="group relative">
            <summary
              id="app-switcher"
              className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-[#2b3141] bg-[#171b26] p-3 text-left text-white shadow-[0_10px_28px_rgba(23,27,38,0.16)] outline-none transition hover:border-[#3c465f] focus-visible:ring-4 focus-visible:ring-blue-500/20"
              aria-label="앱 선택"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#242b3a] text-sm font-bold text-blue-300">S</span>
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[13px] font-bold leading-5">Success AI 광고수집기</strong>
                <small className="block truncate text-[12px] font-medium leading-5 text-slate-300">구글·메타 광고 레퍼런스 수집</small>
              </span>
              <span className="text-slate-400 transition group-open:rotate-180">⌄</span>
            </summary>
            <div className="absolute left-0 top-[calc(100%+8px)] z-20 flex w-full flex-col gap-1 rounded-xl border border-[#2b3141] bg-[#171b26] p-2 shadow-[0_18px_45px_rgba(15,23,42,0.25)]">
              <a className="flex items-center gap-3 rounded-lg px-2 py-2 text-white transition hover:bg-[#242b3a]" href="http://127.0.0.1:3002/">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#242b3a] text-sm font-bold text-blue-300">K</span>
                <span>
                  <strong className="block text-[13px] font-bold leading-5">키워드워처</strong>
                  <small className="block text-[11px] font-medium leading-4 text-slate-400">검색량·시장 트렌드 추적</small>
                </span>
              </a>
              <a className="flex items-center gap-3 rounded-lg bg-[#242b3a] px-2 py-2 text-white" href="http://127.0.0.1:3000/" aria-current="page">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-500 text-sm font-bold text-white">S</span>
                <span>
                  <strong className="block text-[13px] font-bold leading-5">Success AI 광고수집기</strong>
                  <small className="block text-[11px] font-medium leading-4 text-slate-300">구글·메타 광고 레퍼런스 수집</small>
                </span>
              </a>
              <a className="flex items-center gap-3 rounded-lg px-2 py-2 text-white transition hover:bg-[#242b3a]" href="http://127.0.0.1:4317/">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#242b3a] text-sm font-bold text-blue-300">A</span>
                <span>
                  <strong className="block text-[13px] font-bold leading-5">AD FACTORY</strong>
                  <small className="block text-[11px] font-medium leading-4 text-slate-400">광고 설계·제작·배포 자동화</small>
                </span>
              </a>
            </div>
          </details>
          <p className="mt-2 px-1 text-[11px] leading-4 text-slate-400">
            현재 화면은 광고 레퍼런스를 수집하는 Success AI입니다. 키워드워처는 검색량 추적 도구로 분리합니다.
          </p>
        </div>

        <nav className="space-y-1 px-3 py-3" aria-label="Success AI 메뉴">
          {(
            [
              ["archive", "🗂", "브랜드 아카이브", archiveBrands.length],
              ["ads", "▥", "구글 광고", scopedAds.length],
              ["meta", "▣", "메타 광고", null],
              ["creatives", "🎬", "소재 비교", creativePool.length],
              ["dashboard", "▥", "대시보드", null],
              ["guide", "?", "사용법", null],
            ] as const
          ).map(([key, icon, label, count]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-current={tab === key ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition ${
                tab === key
                  ? "bg-[#343846] text-white shadow-sm"
                  : "text-slate-400 hover:bg-[#2b3141] hover:text-slate-100"
              }`}
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center text-[15px] text-slate-400">{icon}</span>
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {count !== null && count > 0 && (
                <span className="rounded-full px-1.5 py-0.5 text-[11px] font-bold text-blue-200">{count.toLocaleString()}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Source switcher — splits the brand list into 🟦 구글 / 📘 메타.
            Auto-syncs to the active main tab via the useEffect above;
            manual click here overrides until the next main-tab change. */}
        <div className="grid grid-cols-2 gap-1 rounded-full bg-[var(--bg-elev)] p-1 mx-3 mt-3">
          {(
            [
              ["google", "🟦 구글", groupedJobs.length],
              ["meta", "📘 메타", metaBrandGroups.length],
            ] as const
          ).map(([key, label, n]) => (
            <button
              key={key}
              onClick={() => setSidebarSource(key)}
              className={`rounded-full px-2 py-1.5 text-xs font-bold transition ${
                sidebarSource === key
                  ? "bg-[var(--bg-card)] text-[var(--accent)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {label} <span className="ml-0.5 opacity-70">{n}</span>
            </button>
          ))}
        </div>

        {/* 첫 진입 안내 — keyword가 하나도 없을 때만 표시 (가벼움) */}
        {groupedJobs.length === 0 && metaBrandGroups.length === 0 && (
          <div className="px-4 py-3 text-xs text-[var(--text-muted)]">
            검색을 누르면 여기로 바로 들어오고, 위에서부터 순서대로 자동
            수집돼요.
          </div>
        )}

        <div className="mv-card mx-3 mt-3 px-3 py-2.5">
          <div className="text-xs text-[var(--text-secondary)]">
            불러온 광고{" "}
            <span className="font-bold text-[var(--text-primary)]">
              {ads.length.toLocaleString()}개
            </span>
          </div>
          {watches.filter((w) => w.active).length > 0 && (
            <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">
              ⭐{" "}
              <b className="text-amber-600">
                {watches.filter((w) => w.active).length}개 추적 중
              </b>
              <span className="mx-1.5 text-[var(--text-muted)]">·</span>
              매일 새벽 3시 자동 재수집
            </div>
          )}
        </div>

        {/* ===== 자동수집 현황 위젯 — 어제 새벽 3시 cron 결과 시각화 =====
            레퍼런스 대시보드 "오늘 자동 수집 13/25 (52%) · 누락 12개" 패턴.
            누락된 keyword는 펼침 가능 — 클릭 시 광고 수집 탭 + 그 keyword
            검색 입력에 자동 채움 → 사용자가 [📢 광고 수집] 한 번 누르면 됨. */}
        {autoCollectStatus.total > 0 && (
          <div className="mv-card mx-3 mt-3 px-3 py-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-[var(--text-muted)]">
                자동수집 · 지난 24h
              </span>
              <span
                className={
                  autoCollectStatus.successRate >= 100
                    ? "font-semibold text-emerald-600/90"
                    : "font-semibold text-[var(--text-secondary)]"
                }
              >
                {autoCollectStatus.success}/{autoCollectStatus.total} (
                {autoCollectStatus.successRate}%)
              </span>
            </div>
            {/* 진행바 — 성공률 시각화. 빨강 없이 차분하게:
                100%면 emerald, 그 외엔 amber. */}
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--bg-elev)]">
              <div
                className={
                  autoCollectStatus.successRate >= 100
                    ? "h-full bg-emerald-500/70"
                    : "h-full bg-amber-500/60"
                }
                style={{
                  width: `${Math.max(autoCollectStatus.successRate, 2)}%`,
                }}
              />
            </div>
            {autoCollectStatus.missingCount > 0 ? (
              <button
                onClick={() => setShowMissing((s) => !s)}
                className="mt-2 flex w-full items-center justify-between rounded-md border border-[var(--border)] bg-[var(--bg-elev)] px-2 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:border-amber-500/40 hover:text-amber-700"
              >
                <span>
                  미수집 {autoCollectStatus.missingCount}개
                  {autoCollectStatus.failedCount > 0 && (
                    <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">
                      (실패 {autoCollectStatus.failedCount} · 미실행{" "}
                      {autoCollectStatus.notRunCount})
                    </span>
                  )}
                </span>
                <span className="text-[var(--text-muted)]">
                  {showMissing ? "▴ 닫기" : "▾ 즉시복구"}
                </span>
              </button>
            ) : (
              <div className="mt-1.5 text-[10px] font-medium text-emerald-600/70">
                정상 · 누락 없음
              </div>
            )}
            {showMissing && autoCollectStatus.missing.length > 0 && (
              <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
                {autoCollectStatus.missing.map((m) => (
                  <li key={`${m.source}::${m.keyword}`}>
                    <button
                      onClick={() => {
                        if (m.source === "meta") {
                          setTab("meta");
                          setSelectedKeyword(m.keyword);
                        } else {
                          setAdQuery(m.keyword);
                          setTab("ads");
                          setSelectedKeyword(m.keyword);
                        }
                      }}
                      title={`${m.reason} · 클릭하면 검색창에 채움`}
                      className="flex w-full items-center justify-between rounded border border-[var(--border)] bg-[var(--bg-elev)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:border-amber-500/40 hover:text-amber-700"
                    >
                      <span className="truncate">
                        {m.source === "meta" ? "📘" : "🟦"} {m.keyword}
                      </span>
                      <span
                        className={
                          m.reason === "실패"
                            ? "ml-1 text-amber-600/80"
                            : "ml-1 text-[var(--text-muted)]"
                        }
                      >
                        {m.reason}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ===== 그룹 (tier) 필터 chip — A1/A2/A3 중요도. 레퍼런스 도구 벤치마크. */}
        <div className="px-3 pt-3">
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            🎨 그룹
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setTierFilter(null)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                tierFilter === null
                  ? "bg-slate-700 text-white"
                  : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-elev)]"
              }`}
            >
              전체
            </button>
            {(["A1", "A2", "A3"] as const).map((t) => {
              const m = TIER_META[t];
              const active = tierFilter === t;
              return (
                <button
                  key={t}
                  onClick={() => setTierFilter(active ? null : t)}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                    active
                      ? `${m.chip} border ring-1`
                      : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-elev)]"
                  }`}
                >
                  <span className={`inline-block h-2 w-2 rounded-full ${m.dot}`} />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ===== 태그 필터 chip group =====
            적어도 태그 1개라도 라벨링된 keyword가 있으면 표시. 클릭 → 그
            태그 가진 keyword만 사이드바에 보임 (groupedJobs 필터링). */}
        {/* 태그 chip 필터 — 메타 / 구글 두 모드 모두 적용. 클릭 → 해당 태그
            가진 keyword만 사이드바에 표시. allTags.length === 0 이면 hidden. */}
        {allTags.length > 0 && (
          <div className="px-3 pt-3">
            <div className="mb-1.5 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              <span>🏷 태그</span>
              {selectedTag && (
                <button
                  onClick={() => setSelectedTag(null)}
                  className="text-[10px] font-normal text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  ✕ 해제
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {allTags.map((t) => {
                const active = selectedTag === t;
                const c = tagColor(t);
                return (
                  <button
                    key={t}
                    onClick={() => setSelectedTag(active ? null : t)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                      active
                        ? `${c.active} ring-1 ${c.ring}`
                        : `border ${c.border} ${c.text} hover:${c.bg}`
                    }`}
                  >
                    #{t}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div
          className={`px-3 pb-3 ${
            sidebarSource === "google" ? "" : "hidden"
          }`}
        >
          {!loaded ? (
            <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
              불러오는 중...
            </div>
          ) : groupedJobs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
              기록이 없습니다
            </div>
          ) : (
            <ul className="max-h-[calc(100vh-260px)] space-y-2 overflow-y-auto">
              {groupedJobs
                .filter((g) => {
                  // 태그 필터 적용 — selectedTag 가 있을 때만.
                  if (selectedTag && !(tagMap[g.keyword] ?? []).includes(selectedTag))
                    return false;
                  // tier(그룹) 필터 — 선택 시 그 tier 인 keyword 만.
                  if (tierFilter) {
                    const w = watches.find(
                      (x) => x.keyword === g.keyword && x.kind === g.kind
                    );
                    if ((w?.tier ?? null) !== tierFilter) return false;
                  }
                  return true;
                })
                .map((g) => {
                const active = selectedKeyword === g.keyword;
                const watched = isWatched(g.keyword, g.kind);
                const wInfo = watchInfo(g.keyword, g.kind);
                const inFlight =
                  g.kind === "ad" ? adCollections[g.keyword] : null;
                const isRunning = inFlight?.busy ?? false;
                const lastLog = inFlight?.logs.length
                  ? inFlight.logs[inFlight.logs.length - 1]
                  : null;
                return (
                  <li key={`${g.kind}::${g.keyword}`}>
                    <div
                      className={`group/job relative overflow-hidden rounded-xl border bg-[var(--bg-card)] shadow-[var(--shadow-card)] transition ${
                        active
                          ? "border-[var(--accent)] ring-2 ring-[var(--accent-soft)]"
                          : isRunning
                          ? "border-[var(--accent)]/50"
                          : "border-[var(--border)] hover:border-[var(--border-strong)]"
                      }`}
                    >
                      <button
                        onClick={() => {
                          setSelectedKeyword(active ? null : g.keyword);
                          if (!active) {
                            // Only switch tab if currently on an
                            // incompatible one. Stay on 소재 분석 if user
                            // is exploring there.
                            if (g.kind !== "ad") {
                              setTab("ads");
                            }
                          }
                        }}
                        className="w-full px-3 py-2 pr-2 text-left text-xs transition-all group-hover/job:pr-[7.5rem]"
                      >
                        <div className="flex items-center gap-2">
                          {/* 아바타 — 아카이브 카드와 같은 색 규칙이라
                              사이드바 ↔ 카드가 같은 브랜드로 인식된다. */}
                          <span className="relative shrink-0">
                            <span
                              aria-hidden
                              className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-black text-white"
                              style={{
                                background: `hsl(${brandHue(g.keyword)} 62% 55%)`,
                              }}
                            >
                              {brandInitial(g.keyword)}
                            </span>
                            {isRunning && (
                              <span className="absolute -right-0.5 -top-0.5 inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)] ring-2 ring-[var(--bg-card)]" />
                            )}
                            {/* tier dot — 클릭 시 A1→A2→A3→없음 cycle */}
                            {g.kind === "ad" && (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void cycleTier(g.keyword);
                                }}
                                title={
                                  wInfo?.tier
                                    ? `그룹 ${wInfo.tier} — 클릭해서 변경`
                                    : "그룹 미지정 — 클릭해서 A1 지정"
                                }
                                className={`absolute -bottom-0.5 -right-0.5 inline-block h-3 w-3 cursor-pointer rounded-full ring-2 ring-[var(--bg-card)] transition hover:scale-125 ${
                                  wInfo?.tier && TIER_META[wInfo.tier]
                                    ? TIER_META[wInfo.tier].dot
                                    : "border border-[var(--border-strong)] bg-[var(--bg-elev)]"
                                }`}
                              />
                            )}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text-primary)]">
                            {g.keyword}
                          </span>
                          {watched && (
                            <span
                              title="매일 자동으로 다시 불러옵니다"
                              className="shrink-0 text-[10px]"
                            >
                              ⭐
                            </span>
                          )}
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold transition group-hover/job:opacity-0 ${
                              isRunning || g.status === "진행 중"
                                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                                : g.status === "대기 중"
                                ? "bg-[var(--bg-elev)] text-[var(--text-muted)]"
                                : g.status === "완료"
                                ? "bg-emerald-500/15 text-emerald-700"
                                : "bg-amber-500/15 text-amber-700"
                            }`}
                          >
                            {isRunning
                              ? `${inFlight!.progress.percent}%`
                              : g.status === "완료"
                              ? "✅"
                              : g.status === "실패"
                              ? "❌"
                              : g.status}
                          </span>
                        </div>
                        {isRunning && (
                          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--bg-base)]">
                            <div
                              className="h-full bg-[var(--accent)] transition-all duration-300"
                              style={{
                                width: `${inFlight!.progress.percent}%`,
                              }}
                            />
                          </div>
                        )}
                        {isRunning && lastLog && (
                          <div className="mt-1 truncate text-[10px] text-[var(--accent)]/80">
                            {lastLog.msg}
                          </div>
                        )}
                        {/* 2줄: 상대시간 · 광고/매칭 — 절대 줄바꿈 없이 한 줄. */}
                        <div className="mt-0.5 flex items-center gap-1 overflow-hidden whitespace-nowrap text-[10px] text-[var(--text-muted)]">
                          <span className="shrink-0" title={formatTime(g.latestAt)}>
                            {formatRelative(g.latestAt)}
                          </span>
                          <span className="shrink-0 text-[var(--text-muted)]/50">·</span>
                          <span className="shrink-0 text-[var(--text-secondary)]">
                            {g.kind === "ad" ? (
                              <>
                                광고 <b className="text-[var(--text-primary)]">{g.adCount}</b>
                                {g.videoCount > 0 && (
                                  <> · 매칭 <b className="text-[var(--text-primary)]">{g.videoCount}</b></>
                                )}
                              </>
                            ) : (
                              <>
                                영상 <b className="text-[var(--text-primary)]">{g.videoCount}</b>
                              </>
                            )}
                          </span>
                        </div>
                        {g.status === "실패" && g.errorMsg && (
                          <div
                            className="mt-1 truncate text-[10px] text-amber-600/80"
                            title={g.errorMsg}
                          >
                            {humanizeErrorMsg(g.errorMsg)}
                          </div>
                        )}
                      </button>
                      {/* ===== 태그 영역 (카드 외곽 — button 밖) =====
                          기존 태그 chip 표시 + "+ 태그" 추가 input. button
                          중첩 방지를 위해 메인 button 밖에 위치. */}
                      <div className="border-t border-[var(--border)] px-3 pb-2 pt-1.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {(tagMap[g.keyword] ?? []).map((t) => {
                            const c = tagColor(t);
                            return (
                              <span
                                key={t}
                                className={`inline-flex items-center gap-1 rounded-full ${c.bg} px-2 py-0.5 text-[10px] font-medium ${c.text}`}
                              >
                                #{t}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeTag(g.keyword, t);
                                  }}
                                  className="hover:text-rose-700"
                                  title="태그 제거"
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                          {editingTagFor === g.keyword ? (
                            <input
                              autoFocus
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  addTag(g.keyword, tagInput);
                                  setTagInput("");
                                  // 연속 입력 가능하게 input 유지
                                } else if (e.key === "Escape") {
                                  setEditingTagFor(null);
                                  setTagInput("");
                                }
                              }}
                              onBlur={() => {
                                if (tagInput.trim()) {
                                  addTag(g.keyword, tagInput);
                                }
                                setEditingTagFor(null);
                                setTagInput("");
                              }}
                              placeholder="태그 입력 → Enter"
                              list="known-tags"
                              className="w-24 rounded-full border border-cyan-500/40 bg-[var(--bg-elev)] px-2 py-0.5 text-[10px] text-cyan-200 outline-none placeholder:text-[var(--text-muted)]"
                            />
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingTagFor(g.keyword);
                                setTagInput("");
                              }}
                              className="rounded-full border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-[10px] text-[var(--text-muted)] hover:border-cyan-500/40 hover:text-cyan-700"
                            >
                              + 태그
                            </button>
                          )}
                        </div>
                      </div>
                      {/* hover 액션 버튼 — flex 컨테이너로 묶어 gap 정렬
                          (개별 absolute right-N 은 간격이 버튼 폭보다 좁아
                          겹쳤음). 평소 숨김, hover 시 우측에 가로로 표시. */}
                      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition group-hover/job:opacity-100">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            const isBusy =
                              (g.kind === "ad" && isBusyKeyword(g.keyword)) ||
                              (g.kind === "youtube" && busyYt === g.keyword);
                            if (isBusy) return;
                            await refreshJob(g.keyword, g.kind);
                          }}
                          disabled={
                            (g.kind === "ad" && isBusyKeyword(g.keyword)) ||
                            (g.kind === "youtube" && busyYt === g.keyword)
                          }
                          title="지금 재수집"
                          className="rounded p-1 text-[var(--text-muted)] hover:bg-emerald-500/20 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          🔄
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            await toggleWatch(g.keyword, g.kind);
                          }}
                          title={watched ? "자동 추적 해제" : "자동 추적 켜기"}
                          className={`rounded p-1 transition ${
                            watched
                              ? "text-amber-600 hover:bg-amber-500/20"
                              : "text-[var(--text-muted)] hover:bg-amber-500/20 hover:text-amber-600"
                          }`}
                        >
                          {watched ? "⭐" : "☆"}
                        </button>
                        {watched && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              await toggleDaily(
                                g.keyword,
                                g.kind,
                                !(wInfo?.daily ?? false)
                              );
                            }}
                            title={
                              wInfo?.daily
                                ? "매일 추적 중 (클릭 → 격일로)"
                                : "격일 추적 중 (클릭 → 매일로)"
                            }
                            className={`rounded px-1 py-1 text-[9px] font-semibold transition ${
                              wInfo?.daily
                                ? "text-amber-600 hover:bg-amber-500/20"
                                : "text-[var(--text-muted)] hover:bg-blue-500/20 hover:text-blue-700"
                            }`}
                          >
                            {wInfo?.daily ? "매일" : "격일"}
                          </button>
                        )}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (
                              !confirm(
                                `"${g.keyword}" ${
                                  g.kind === "ad" ? "광고 수집" : "YouTube 검색"
                                } 결과를 삭제할까요?`
                              )
                            )
                              return;
                            await fetch("/api/jobs", {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                keyword: g.keyword,
                                kind: g.kind,
                              }),
                            });
                            if (selectedKeyword === g.keyword)
                              setSelectedKeyword(null);
                            await refreshAll();
                          }}
                          title="이 작업 삭제"
                          className="rounded p-1 text-[var(--text-muted)] hover:bg-rose-500/20 hover:text-rose-700"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* === Meta brand groups === sock-puppet pages collapsed under
            their anchor brand. Click → switches to 메타 광고 tab and
            auto-selects the brand in MetaView. Visible only when the
            sidebar source toggle is set to 메타. */}
        {sidebarSource === "meta" && (
          <div className="px-3 pb-3 pt-3">
            <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              <span>📘 메타 광고 브랜드</span>
              <span className="text-[10px] font-normal normal-case">
                {metaBrandGroups.length}개
              </span>
            </div>
            {metaBrandGroups.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
                📘 메타 광고 탭 → 새 brand 입력으로 시작
              </div>
            ) : (
            <ul className="max-h-[calc(100vh-260px)] space-y-2 overflow-y-auto">
              {metaBrandGroups
                .filter((g) => {
                  // 태그 필터 — 메타 brand의 anchor keyword에 selectedTag 있어야 통과
                  if (!selectedTag) return true;
                  return (tagMap[g.anchor] ?? []).includes(selectedTag);
                })
                .map((g) => {
                const active =
                  tab === "meta" && selectedKeyword === g.anchor;
                const isRunning = g.runningCount > 0;
                const hasError = !isRunning && g.erroredCount > 0;
                // Meta brand groups are always tracked — every entry here
                // came from an active MetaWatch (or an orphaned job we
                // promoted to anchor). Show ⭐ to signal that, matching
                // the Google card's tracked-state visual.
                const watched = metaWatches.some(
                  (w) =>
                    w.active && (w.keyword === g.anchor || w.anchorKeyword === g.anchor)
                );
                return (
                  <li key={`meta::${g.anchor}`}>
                    <div
                      className={`group/meta relative rounded-lg border transition ${
                        active
                          ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/30"
                          : isRunning
                          ? "border-blue-500/50 bg-blue-500/5"
                          : watched
                          ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60"
                          : "border-[var(--border)] bg-[var(--bg-elev)] hover:border-[var(--border-strong)]"
                      }`}
                    >
                      <button
                        onClick={() => {
                          setTab("meta");
                          setSelectedKeyword(g.anchor);
                        }}
                        className="w-full px-3 py-2 pr-2 text-left text-xs transition-all group-hover/meta:pr-14"
                      >
                        <div className="flex items-center gap-1.5">
                          {isRunning && (
                            <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-400" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-primary)]">
                            {g.anchor}
                          </span>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold transition group-hover/meta:opacity-0 ${
                              isRunning
                                ? "bg-blue-500/20 text-blue-700"
                                : hasError
                                ? "bg-slate-500/20 text-amber-700"
                                : g.adCount > 0 || g.pageCount > 0
                                ? "bg-emerald-500/20 text-emerald-700"
                                : "bg-slate-500/20 text-slate-700"
                            }`}
                          >
                            {isRunning
                              ? `🔄`
                              : hasError
                              ? `❌`
                              : g.adCount > 0 || g.pageCount > 0
                              ? "✅"
                              : "대기"}
                          </span>
                        </div>
                        {/* 2줄: 상대시간 · 광고 N · 페이지 N — 절대 줄바꿈 없이 한 줄. */}
                        <div className="mt-0.5 flex items-center gap-1 overflow-hidden whitespace-nowrap text-[10px] text-[var(--text-muted)]">
                          <span className="shrink-0" title={g.latestAt ? formatTime(g.latestAt) : ""}>
                            {g.latestAt ? formatRelative(g.latestAt) : "수집 전"}
                          </span>
                          <span className="shrink-0 text-[var(--text-muted)]/50">·</span>
                          <span className="shrink-0 text-[var(--text-secondary)]">
                            광고 <b className="text-[var(--text-primary)]">{g.adCount}</b>
                            {g.pageWatches > 0 && (
                              <> · 페이지 <b className="text-[var(--text-primary)]">{g.pageWatches}</b></>
                            )}
                          </span>
                          {g.autoCount > 0 && (
                            <span
                              title={`자동 발굴 ${g.autoCount}${g.manualCount > 0 ? ` · 수동 ${g.manualCount}` : ""}${g.seedCount > 0 ? ` · seed ${g.seedCount}` : ""}`}
                              className="ml-auto shrink-0 rounded bg-emerald-500/12 px-1 py-0.5 text-[9px] text-emerald-700/90"
                            >
                              auto {g.autoCount}
                            </span>
                          )}
                        </div>
                      </button>
                      {/* ===== 태그 영역 (카드 외곽 — button 밖) =====
                          기존 태그 chip 표시 + "+ 태그" 추가 input. button
                          중첩 방지를 위해 메인 button 밖에 위치. */}
                      <div className="border-t border-[var(--border)] px-3 pb-2 pt-1.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {(tagMap[g.anchor] ?? []).map((t) => {
                            const c = tagColor(t);
                            return (
                              <span
                                key={t}
                                className={`inline-flex items-center gap-1 rounded-full ${c.bg} px-2 py-0.5 text-[10px] font-medium ${c.text}`}
                              >
                                #{t}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeTag(g.anchor, t);
                                  }}
                                  className="hover:text-rose-700"
                                  title="태그 제거"
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                          {editingTagFor === g.anchor ? (
                            <input
                              autoFocus
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  addTag(g.anchor, tagInput);
                                  setTagInput("");
                                } else if (e.key === "Escape") {
                                  setEditingTagFor(null);
                                  setTagInput("");
                                }
                              }}
                              onBlur={() => {
                                if (tagInput.trim()) addTag(g.anchor, tagInput);
                                setEditingTagFor(null);
                                setTagInput("");
                              }}
                              placeholder="태그 입력 → Enter"
                              list="known-tags"
                              className="w-24 rounded-full border border-cyan-500/40 bg-[var(--bg-elev)] px-2 py-0.5 text-[10px] text-cyan-200 outline-none placeholder:text-[var(--text-muted)]"
                            />
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingTagFor(g.anchor);
                                setTagInput("");
                              }}
                              className="rounded-full border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-[10px] text-[var(--text-muted)] hover:border-cyan-500/40 hover:text-cyan-700"
                            >
                              + 태그
                            </button>
                          )}
                        </div>
                      </div>
                      {/* 지금 재수집 — 구글 카드의 🔄 와 동일. anchor keyword 를
                          메타 큐에 다시 넣어 stage 1 + 1.5 를 재실행한다. 실패로
                          끝난 brand 도 새 코드 + 살아있는 프록시로 재시도 가능. */}
                      {/* hover 액션 버튼 — flex 컨테이너로 묶어 gap 정렬. */}
                      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition group-hover/meta:opacity-100">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (isRunning) return;
                            // 트래픽 안내 — 메타 1회 수집 ~200MB. 프록시 경유 시 그만큼 차감.
                            // 사용자가 의식하고 누르도록 confirm. 자주 누르면
                            // 트래픽 빠르게 소진.
                            if (
                              !confirm(
                                `"${g.anchor}" 메타 광고 재수집\n\n` +
                                  `📊 예상 트래픽: 약 200MB\n` +
                                  `프록시를 쓰신다면 그만큼 차감됩니다.\n\n` +
                                  `진행할까요?`
                              )
                            )
                              return;
                            await fetch("/api/meta/queue", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ keyword: g.anchor }),
                            }).catch(() => {});
                            await refreshAll();
                          }}
                          disabled={isRunning}
                          title="지금 메타 다시 불러오기 (약 200MB)"
                          className="rounded p-1 text-[var(--text-muted)] hover:bg-emerald-500/20 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          🔄
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (
                              !confirm(
                                `"${g.anchor}" 메타 브랜드 추적을 해제할까요? (관련 키워드 ${g.keywords.length}개 모두 해제)`
                              )
                            )
                              return;
                            // Delete every MetaWatch row tied to this anchor
                            // (brand keyword + page:* sock-puppet rows).
                            for (const kw of g.keywords) {
                              await fetch("/api/meta-watch", {
                                method: "DELETE",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({ keyword: kw }),
                              }).catch(() => {});
                            }
                            if (selectedKeyword === g.anchor)
                              setSelectedKeyword(null);
                            await refreshAll();
                          }}
                          title="이 브랜드 추적 해제"
                          className="rounded p-1 text-[var(--text-muted)] hover:bg-rose-500/20 hover:text-rose-700"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            )}
          </div>
        )}

        <div className="mt-auto border-t border-[#343b4c] px-3 py-4">
          {(jobs.length > 0 || ads.length > 0) && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteOpen((open) => !open);
                  setDeleteError(null);
                  setDeleteDone(false);
                }}
                className="block w-full rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-400/20"
              >
                🗑️ 전체 데이터 삭제
              </button>
              {deleteOpen && (
                <form
                  className="space-y-2 rounded-lg border border-rose-400/30 bg-rose-400/10 p-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void clearAll();
                  }}
                >
                  <p className="text-[11px] leading-4 text-rose-100/90">
                    되돌릴 수 없습니다. 관리자 비밀번호를 입력하세요.
                  </p>
                  <input
                    type="password"
                    value={deleteSecret}
                    onChange={(event) => setDeleteSecret(event.target.value)}
                    placeholder="관리자 비밀번호"
                    autoComplete="off"
                    className="w-full rounded-md border border-rose-300/30 bg-[#171b26] px-2 py-1.5 text-xs text-white outline-none placeholder:text-slate-500 focus:border-rose-300/70"
                  />
                  {deleteError && <p className="text-[11px] text-rose-200">{deleteError}</p>}
                  <div className="flex gap-1.5">
                    <button
                      type="submit"
                      disabled={!deleteSecret.trim() || deletingAll}
                      className="flex-1 rounded-md bg-rose-500 px-2 py-1.5 text-[11px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingAll ? "삭제 중…" : "삭제 실행"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteOpen(false);
                        setDeleteSecret("");
                        setDeleteError(null);
                      }}
                      className="rounded-md border border-slate-500/40 px-2 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-700/40"
                    >
                      취소
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
          {deleteDone && (
            <p className="mt-2 rounded-lg bg-emerald-400/10 px-2 py-1.5 text-[11px] text-emerald-200">
              전체 데이터가 삭제되었습니다.
            </p>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-x-auto">
        {/* 검색 헤더 — 이 도구에서 사용자가 제일 먼저 하는 행동이
            "브랜드 하나 넣고 불러오기" 라서, 탭보다 검색을 위에 둔다. */}
        <header className="border-b border-[var(--border)] bg-[var(--bg-card)] px-6 pb-4 pt-5">
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base text-[var(--text-muted)]">
              🔍
            </span>
            <input
              value={adQuery}
              onChange={(e) => setAdQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runAdSearch();
              }}
              placeholder="브랜드명 또는 도메인으로 검색 (예: 올리브영, oliveyoung.co.kr)"
              className="w-full rounded-full border border-[var(--border-strong)] bg-[var(--bg-elev)] py-3 pl-11 pr-32 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:bg-[var(--bg-card)] focus:ring-4 focus:ring-[var(--accent-soft)]"
            />
            <button
              onClick={runAdSearch}
              disabled={!adQuery.trim() || isBusyKeyword(adQuery.trim())}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isBusyKeyword(adQuery.trim())
                ? "불러오는 중"
                : anyBusyAds
                ? "추가 수집"
                : "불러오기"}
            </button>
          </div>

          {/* 예시 칩 — 빈 화면에서 뭘 넣어야 할지 알려주는 역할. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-[var(--text-muted)]">예시</span>
            {["올리브영", "무신사", "oliveyoung.co.kr"].map((d) => (
              <button
                key={d}
                onClick={() => setAdQuery(d)}
                className="rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-2.5 py-1 font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {d}
              </button>
            ))}
            <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={snapshotMode}
                onChange={(e) => setSnapshotMode(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              📸 1회만 (자동 갱신 안 함)
            </label>
          </div>
        </header>

        {/* 소스 탭 — 무료 배포판은 구글 투명성 센터 + 메타 두 곳만 다룬다. */}
        <div className="border-b border-[var(--border)] bg-[var(--bg-card)] px-6">
          <div className="flex gap-1.5 pb-3">
            {(
              [
                ["archive", "🗂 브랜드 아카이브", archiveBrands.length],
                ["ads", "🟦 구글 광고", scopedAds.length],
                ["meta", "📘 메타 광고", null],
                ["creatives", "🎬 소재 비교", creativePool.length],
                ["dashboard", "📊 대시보드", null],
                ["guide", "❓ 사용법", null],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                  tab === key
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-elev)]"
                }`}
              >
                {label}
                {count !== null && count > 0 && (
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                      tab === key
                        ? "bg-white/25"
                        : "bg-[var(--bg-elev)] text-[var(--text-muted)]"
                    }`}
                  >
                    {count.toLocaleString()}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5 p-6">
          {selectedKeyword && tab !== "creatives" && (
            <div className="flex items-center justify-between rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-sm">
              <div className="flex items-center gap-2 text-indigo-700">
                <span>🔍</span>
                <span>
                  검색어 <b>"{selectedKeyword}"</b>의 결과만 보고 있어요
                </span>
              </div>
              <button
                onClick={() => setSelectedKeyword(null)}
                className="rounded-md px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-500/20"
              >
                ✕ 전체 보기
              </button>
            </div>
          )}

          {/* ===== 광고주 순위 패널 ===== 레퍼런스 대시보드의 "내가 추적
              중인 N개 업체 중 이 광고주 위치" 위젯. 레퍼런스/소재 탭에서
              selectedKeyword 있을 때만. */}
          {selectedKeyword &&
            (tab === "ads" || tab === "creatives") &&
            advertiserRanking &&
            advertiserRanking.total >= 2 && (
              <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-base">🏆</span>
                  <span className="text-sm font-semibold">
                    내가 추적 중인 {advertiserRanking.total}개 업체 중 이
                    광고주 위치
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* 소재수 순위 */}
                  <div>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-xs text-[var(--text-secondary)]">
                        🎬 광고 소재수
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {advertiserRanking.adCount}개
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold tabular-nums text-amber-700">
                        {advertiserRanking.adRank}위
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        / {advertiserRanking.total}
                      </span>
                      <span
                        className={`ml-auto text-[11px] font-semibold ${
                          advertiserRanking.adRankPercent >= 80
                            ? "text-amber-600"
                            : advertiserRanking.adRankPercent >= 50
                            ? "text-emerald-600"
                            : "text-[var(--text-muted)]"
                        }`}
                      >
                        {advertiserRanking.adRankPercent >= 80
                          ? "🔥 상위"
                          : advertiserRanking.adRankPercent >= 50
                          ? "📈 중상위"
                          : "중하위"}{" "}
                        {100 - advertiserRanking.adRankPercent + 1}%
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--bg-elev)]">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-amber-300"
                        style={{
                          width: `${advertiserRanking.adRankPercent}%`,
                        }}
                      />
                    </div>
                  </div>
                  {/* 가속도 순위 (analyzeDays 기준) */}
                  <div>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-xs text-[var(--text-secondary)]">
                        🚀 가속도 (
                        {analyzeDays === "all"
                          ? "전체"
                          : `최근 ${analyzeDays}일`}
                        )
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {advertiserRanking.avgAccel >= 0 ? "+" : ""}
                        {advertiserRanking.avgAccel.toLocaleString()}/일
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold tabular-nums text-emerald-700">
                        {advertiserRanking.accelRank}위
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        / {advertiserRanking.total}
                      </span>
                      <span
                        className={`ml-auto text-[11px] font-semibold ${
                          advertiserRanking.accelRankPercent >= 80
                            ? "text-rose-600"
                            : advertiserRanking.accelRankPercent >= 50
                            ? "text-emerald-600"
                            : "text-[var(--text-muted)]"
                        }`}
                      >
                        {advertiserRanking.accelRankPercent >= 80
                          ? "🔥 상위"
                          : advertiserRanking.accelRankPercent >= 50
                          ? "📈 중상위"
                          : "중하위"}{" "}
                        {100 - advertiserRanking.accelRankPercent + 1}%
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--bg-elev)]">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300"
                        style={{
                          width: `${advertiserRanking.accelRankPercent}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-[10px] text-[var(--text-muted)]">
                  기준: 분석 기간(
                  {analyzeDays === "all" ? "전체" : `${analyzeDays}일`}) 내
                  본인이 추적 중인 업체들 사이에서의 순위
                </div>
              </section>
            )}

          {/* ===== 스냅샷 타임라인 ===== 그 keyword 광고들의 AdStat
              capturedDate union. 가로 chip 한 줄. 클릭 → 그 날 이후 등장한
              광고만 필터링. 레퍼런스 대시보드의 시간 칩 UX와 동일. */}
          {selectedKeyword &&
            tab === "ads" &&
            snapshotTimeline &&
            snapshotTimeline.dates.length > 0 && (
              <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--text-secondary)]">
                    📅 스냅샷 {snapshotTimeline.dates.length}개
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    최초: {snapshotTimeline.first} · 최신:{" "}
                    {snapshotTimeline.last}
                  </span>
                </div>
                <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
                  <button
                    onClick={() => setSinceDateFilter(null)}
                    className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold transition ${
                      sinceDateFilter === null
                        ? "bg-indigo-500 text-white"
                        : "border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
                    }`}
                  >
                    전체 ({snapshotTimeline.totalAds})
                  </button>
                  {snapshotTimeline.dates.map((d, i) => {
                    const active = sinceDateFilter === d;
                    const n = snapshotTimeline.newSince(d);
                    return (
                      <button
                        key={d}
                        onClick={() =>
                          setSinceDateFilter(active ? null : d)
                        }
                        title={`${d} 이후 ATC에 처음 등장한 광고: ${n}개`}
                        className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-medium transition ${
                          active
                            ? "bg-cyan-500/30 text-cyan-200 ring-1 ring-cyan-500/50"
                            : "border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
                        }`}
                      >
                        {i + 1}.{" "}
                        {d.replace(/^\d{4}-/, "").replace("-", "/")}
                        {n > 0 && (
                          <span className="ml-1 text-[9px] text-emerald-600">
                            +{n}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {sinceDateFilter && (
                  <div className="mt-2 text-[10px] text-cyan-700">
                    🔍 {sinceDateFilter} 이후 ATC에 처음 등장한 광고만 보고
                    있어요 — 같은 카드의 ✕ 클릭으로 해제
                  </div>
                )}
              </section>
            )}

          {tab === "guide" ? (
            <GuideView onGoTo={(t) => setTab(t)} />
          ) : tab === "archive" ? (
            <BrandArchive
              brands={archiveBrands}
              onOpen={(kw) => {
                setSelectedKeyword(kw);
                setTab("ads");
              }}
              onRefresh={(kw) => startAdCollection(kw)}
              busyKeywords={
                new Set(
                  Object.entries(adCollections)
                    .filter(([, c]) => c.busy)
                    .map(([kw]) => kw)
                )
              }
              emptyHint={
                <>
                  아직 불러온 브랜드가 없어요.
                  <div className="mt-2 text-xs">
                    위 검색창에 도메인이나 브랜드명을 넣어보세요.
                  </div>
                </>
              }
            />
          ) : tab === "dashboard" ? (
            <DashboardView />

          ) : tab === "meta" ? (
            <MetaView selectedKeyword={selectedKeyword} />

          ) : tab === "creatives" ? (
            <CreativesView
              pool={creativePool}
              sort={creativesSort}
              sortDir={creativesSortDir}
              onSort={toggleCreativesSort}
              classFilter={classFilter}
              onClassFilterChange={setClassFilter}
              domains={allAdDomains}
              domainFilter={creativeDomainFilter}
              onDomainFilterChange={setCreativeDomainFilter}
            />
          ) : tab === "ads" ? (
            <>
              {/* 데이터 출처 안내 — 표의 조회수를 광고 노출수로 오해하는
                  일이 실제로 잦다. 구글은 노출/비용을 공개하지 않고, 이
                  숫자는 광고 소재로 쓰인 YouTube 영상의 공개 통계다. */}
              <div className="mv-card flex items-start gap-3 p-4">
                <span className="text-lg leading-none">🟦</span>
                <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  <b className="text-[var(--text-primary)]">
                    구글 광고 투명성 센터
                  </b>
                  에서 가져온 광고입니다. 구글은 노출수·비용을 공개하지 않아서,
                  영상 광고는 소재로 쓰인{" "}
                  <b className="text-rose-600">▶️ YouTube 영상의 공개 통계</b>
                  (조회수·좋아요·게시일)를 붙여 성과를 가늠합니다.
                  <div className="mt-1 text-[var(--text-muted)]">
                    조회수는 광고 노출수가 아니라 유기적 조회까지 합쳐진
                    숫자입니다. 절대값보다 <b>브랜드 안에서의 상대 순위</b>로
                    보세요. 이미지 광고는 숫자가 비어 있는 게 정상입니다.
                  </div>
                </div>
                <button
                  onClick={() => setTab("guide")}
                  className="shrink-0 rounded-lg border border-[var(--border-strong)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  자세히
                </button>
              </div>

              {/* Live log + progress for the currently selected collection */}
              {currentCollection &&
                (currentCollection.busy ||
                  currentCollection.logs.length > 0) && (
                  <LogConsole
                    keyword={selectedKeyword ?? ""}
                    logs={currentCollection.logs}
                    progress={currentCollection.progress}
                    busy={currentCollection.busy}
                    onClear={() => {
                      if (selectedKeyword) {
                        setAdCollections((prev) => {
                          const next = { ...prev };
                          delete next[selectedKeyword];
                          return next;
                        });
                      }
                    }}
                    scrollRef={logScrollRef}
                    activeKeywords={Object.entries(adCollections)
                      .filter(([, c]) => c.busy)
                      .map(([k]) => k)}
                    onSelectKeyword={setSelectedKeyword}
                  />
                )}

              {/* Counter row */}
              <div className="flex flex-wrap items-center gap-3">
                <div
                  className="text-sm text-[var(--text-secondary)]"
                  title="광고 = 수집된 전체 / 영상 후보 = 영상·기타 타입 / YouTube 매칭 = 영상 ID 추출 성공 / 고유 영상 = youtubeId 중복 제거"
                >
                  광고{" "}
                  <span className="text-lg font-bold text-amber-600">
                    {totalAds}
                  </span>
                  <span className="mx-1.5 text-[var(--text-muted)]">·</span>
                  영상 후보{" "}
                  <span className="font-bold text-[var(--text-primary)]">
                    {totalEligible}
                  </span>
                  <span className="mx-1.5 text-[var(--text-muted)]">·</span>
                  YouTube 매칭{" "}
                  <span className="font-bold text-emerald-600">
                    {totalMatched}
                  </span>
                  <span className="mx-1.5 text-[var(--text-muted)]">·</span>
                  고유 영상{" "}
                  <span className="text-lg font-bold text-rose-600">
                    {totalAdVideos}
                  </span>
                </div>
                {/* 상한에 걸리면 조용히 자르지 않고 알린다 — 안 그러면 아래
                    광고주/채널 필터에 일부 광고주만 뜨는 걸 버그로 오해한다. */}
                {ads.length >= INITIAL_ADS_LIMIT && (
                  <span
                    className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                    title={`첫 로딩은 최근 수집순 ${INITIAL_ADS_LIMIT}건까지만 가져옵니다. 사이드바에서 브랜드를 클릭하면 그 브랜드 전체를 불러옵니다.`}
                  >
                    ⚠️ 최근 {INITIAL_ADS_LIMIT.toLocaleString()}건만 불러옴 —
                    사이드바에서 브랜드를 클릭하면 전체 로드
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={copyLinks}
                    disabled={sortedAds.length === 0}
                    title="보이는 광고의 YouTube 링크를 '브랜드 | URL' 형식으로 복사 — ad-factory refs/inbox/list.txt 에 붙여넣기"
                    className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
                  >
                    {copiedCount !== null ? `✅ ${copiedCount}개 복사됨` : "📋 링크 복사"}
                  </button>
                  <button
                    onClick={downloadCSV}
                    disabled={sortedAds.length === 0}
                    className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
                  >
                    📥 CSV
                  </button>
                  <button
                    onClick={downloadJSON}
                    disabled={sortedAds.length === 0}
                    className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
                  >
                    📥 JSON
                  </button>
                </div>
              </div>

              {/* 분석 기간 셀렉터 — delta/%/D+N 컬럼이 이 윈도우 기준으로
                  계산됨. 7일이 default. "전체"는 snapshot 첫~끝 사용. */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                  📅 분석 기간
                </span>
                <div className="flex rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] p-0.5">
                  {(["all", 7, 14, 30, 90] as const).map((d) => (
                    <button
                      key={String(d)}
                      onClick={() => setAnalyzeDays(d)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                        analyzeDays === d
                          ? "bg-indigo-500 text-white"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
                      }`}
                    >
                      {d === "all" ? "전체" : `${d}일`}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">
                  변화·성장률 컬럼 기준
                </span>
              </div>

              {/* 상태 분류 chip 필터 — classifyAd 결과 중 한 가지를 골라 필터.
                  스크린샷의 레퍼런스 대시보드 "스파이크/신규/히어로/피로도" 패턴. */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                  🏷 상태
                </span>
                <button
                  onClick={() => setClassFilter("all")}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                    classFilter === "all"
                      ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                      : "border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
                  }`}
                >
                  전체
                </button>
                {(
                  [
                    "신규광고",
                    "스파이크",
                    "히어로",
                    "가속도",
                    "피로도",
                  ] as const
                ).map((c) => {
                  const m = CLASSIFICATION_META[c];
                  const active = classFilter === c;
                  return (
                    <button
                      key={c}
                      onClick={() =>
                        setClassFilter(active ? "all" : c)
                      }
                      title={m.tip}
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                        active
                          ? `${m.bg} ${m.text} ring-1 ring-current`
                          : `border border-[var(--border)] ${m.text} hover:${m.bg}`
                      }`}
                    >
                      {m.emoji} {m.label}
                    </button>
                  );
                })}
              </div>

              {/* Filter chips */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setFilter(filter === "hero" ? "all" : "hero")}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    filter === "hero"
                      ? "bg-indigo-600 text-white"
                      : "border border-indigo-500/40 bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/20"
                  }`}
                >
                  ⭐ 주력 소재 50만+
                </button>
                <button
                  onClick={() =>
                    setFilter(filter === "growing" ? "all" : "growing")
                  }
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    filter === "growing"
                      ? "bg-teal-600 text-white"
                      : "border border-teal-500/40 bg-teal-500/10 text-teal-700 hover:bg-teal-500/20"
                  }`}
                >
                  📈 상승세 10만+ 또는 일 3천+
                </button>
                <span className="ml-2 text-[11px] text-[var(--text-muted)]">
                  조회수 밑 XXX회/일 = 게시일 기준 하루 평균 조회수
                </span>
                {/* 🎯 이 도메인만 토글 — Stage3 형제 brand 제거. 도메인 모드
                    검색일 때만 (via 데이터 있을 때만) 표시. 재수집 안 한
                    레거시 광고는 다 빠지니까 (n) 으로 명시. */}
                {hasDomainModeAds && (
                  <button
                    onClick={() => setDomainOnly((v) => !v)}
                    title="같은 광고주가 굴리는 다른 브랜드 광고를 숨기고, 검색한 도메인이 직접 띄운 것만 표시"
                    className={`ml-2 rounded-full px-3 py-1 text-xs font-semibold transition ${
                      domainOnly
                        ? "bg-amber-500 text-white"
                        : "border border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20"
                    }`}
                  >
                    🎯 이 도메인만 ({domainAdsCount})
                  </button>
                )}
                {/* 조회수 대역 + 소재 나이 콤보 — 레퍼런스 도구 벤치마크.
                    메가히트/롱런(검증된 소재) 만 골라보기. */}
                <select
                  value={viewBand}
                  onChange={(e) => setViewBand(e.target.value)}
                  className={`ml-2 rounded-md border px-2 py-1 text-[11px] outline-none ${
                    viewBand
                      ? "border-indigo-500 bg-indigo-500/10 font-semibold text-indigo-700"
                      : "border-[var(--border-strong)] bg-[var(--bg-elev)] text-[var(--text-secondary)]"
                  }`}
                  title="조회수 대역 필터"
                >
                  <option value="">👁️ 조회수 전체</option>
                  <option value="0:30000">~3만 (테스트)</option>
                  <option value="30000:300000">3만~30만</option>
                  <option value="300000:3000000">30만~300만 (통한 소재)</option>
                  <option value="3000000:20000000">300만~2000만 (대형)</option>
                  <option value="20000000:">2000만+ (전국구)</option>
                </select>
                <select
                  value={ageBand}
                  onChange={(e) => setAgeBand(e.target.value)}
                  className={`rounded-md border px-2 py-1 text-[11px] outline-none ${
                    ageBand
                      ? "border-emerald-500 bg-emerald-500/10 font-semibold text-emerald-700"
                      : "border-[var(--border-strong)] bg-[var(--bg-elev)] text-[var(--text-secondary)]"
                  }`}
                  title="소재 나이 — 오래 살아남은 광고 = 검증된 소재"
                >
                  <option value="">⏳ 나이 전체</option>
                  <option value="old:21">3주+ (살아남은 소재)</option>
                  <option value="old:60">2개월+ (검증된 소재)</option>
                </select>
                {/* 결과 내 검색 — 한 광고주(예: 모브랜드사)에 brand 가 여러
                    개 섞일 때 "브랜드D" / "브랜드E" 입력으로 좁힘. 제목/채널/
                    광고주명 contains 매칭. */}
                <div className="ml-auto flex items-center gap-1">
                  <input
                    value={innerSearch}
                    onChange={(e) => setInnerSearch(e.target.value)}
                    placeholder="🔍 결과 내 검색 (제목/채널/광고주)"
                    className="w-64 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                  />
                  {innerSearch && (
                    <button
                      onClick={() => setInnerSearch("")}
                      title="검색 지우기"
                      className="rounded-full p-1 text-[var(--text-muted)] hover:bg-rose-500/20 hover:text-rose-700"
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="ml-auto flex gap-1">
                  {(
                    ["all", "youtube", "image", "video", "other"] as const
                  ).map((t) => (
                    <button
                      key={t}
                      onClick={() => setAdTypeFilter(t)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                        adTypeFilter === t
                          ? t === "youtube"
                            ? "bg-rose-500 text-white"
                            : "bg-indigo-500 text-white"
                          : "border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
                      }`}
                    >
                      {t === "all"
                        ? "전체"
                        : t === "youtube"
                        ? "🎬 YouTube"
                        : t === "image"
                        ? "이미지"
                        : t === "video"
                        ? "영상"
                        : "기타"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Advertiser chips */}
              {advertiserGroups.length > 0 && (
                <section className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">
                    광고주
                  </span>
                  {advertiserGroups.slice(0, 8).map((g) => (
                    <a
                      key={g.id}
                      href={`https://adstransparency.google.com/advertiser/${g.id}?region=KR`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full bg-[var(--bg-elev)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
                    >
                      {g.name || "(이름 없음)"}{" "}
                      <span className="ml-1 font-semibold text-[var(--text-primary)]">
                        {g.count}
                      </span>
                    </a>
                  ))}
                </section>
              )}

              {/* 채널 chip multi-select — 한 광고주(예: 모브랜드사) 안에
                  brand(브랜드D/브랜드E/브랜드F) 가 여러 채널로 갈릴 때 클릭
                  toggle 로 좁힘. 2개 이상일 때만 표시. innerSearch 와 AND. */}
              {channelChips.length >= 2 && (
                <section className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">
                    채널
                  </span>
                  {channelChips.map((c) => {
                    const active = selectedChannels.has(c.label);
                    return (
                      <button
                        key={c.label}
                        onClick={() => {
                          setSelectedChannels((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.label)) next.delete(c.label);
                            else next.add(c.label);
                            return next;
                          });
                        }}
                        className={`rounded-full px-3 py-1 text-xs transition ${
                          active
                            ? "bg-amber-500 text-white font-semibold"
                            : "border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {c.label}{" "}
                        <span
                          className={`ml-1 font-semibold ${
                            active ? "text-white" : "text-[var(--text-primary)]"
                          }`}
                        >
                          {c.count}
                        </span>
                      </button>
                    );
                  })}
                  {selectedChannels.size > 0 && (
                    <button
                      onClick={() => setSelectedChannels(new Set())}
                      className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs text-rose-700 hover:bg-rose-500/20"
                    >
                      ✕ 채널 필터 해제 ({selectedChannels.size})
                    </button>
                  )}
                </section>
              )}

              {/* Unified ads table — 항상 200개 cap. brand 선택해도 한 번에
                  너무 많은 썸네일 (mqdefault.jpg 수천 개) 동시 fetch 하면
                  네트워크 40초+. "더 보기" 클릭 시 +200 추가. */}
              <AdsTable
                groups={groupedAds.slice(0, displayLimit)}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                analyzeDays={analyzeDays}
              />
              {groupedAds.length > displayLimit && (
                <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-card)] px-4 py-3 text-center text-xs text-[var(--text-muted)]">
                  📊 광고 {displayLimit.toLocaleString()}/{groupedAds.length.toLocaleString()}개 표시 중
                  <button
                    onClick={() => setDisplayLimit((n) => n + 200)}
                    className="ml-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-700 hover:bg-amber-500/20"
                  >
                    + 200개 더 보기
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
  total,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  total: number;
  accent: "amber" | "rose" | "emerald" | "indigo";
}) {
  const accentClasses =
    accent === "amber"
      ? "border-amber-500 text-amber-600"
      : accent === "rose"
      ? "border-rose-500 text-rose-600"
      : accent === "indigo"
      ? "border-indigo-500 text-indigo-600"
      : "border-emerald-500 text-emerald-600";
  const badgeClasses =
    active && accent === "amber"
      ? "bg-amber-500/20 text-amber-700"
      : active && accent === "rose"
      ? "bg-rose-500/20 text-rose-700"
      : active && accent === "emerald"
      ? "bg-emerald-500/20 text-emerald-700"
      : active && accent === "indigo"
      ? "bg-indigo-500/20 text-indigo-700"
      : "bg-[var(--bg-elev)] text-[var(--text-secondary)]";
  return (
    <button
      onClick={onClick}
      className={`relative -mb-px border-b-2 px-4 py-3 text-sm font-semibold transition ${
        active
          ? accentClasses
          : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      }`}
    >
      {label}
      {!(count === 0 && total === 0) && (
        <span
          className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${badgeClasses}`}
        >
          {count}
          {total !== count && <span className="opacity-60">/{total}</span>}
        </span>
      )}
    </button>
  );
}

function LogConsole({
  keyword,
  logs,
  progress,
  busy,
  onClear,
  scrollRef,
  activeKeywords,
  onSelectKeyword,
}: {
  keyword: string;
  logs: LogLine[];
  progress: { step: string; percent: number };
  busy: boolean;
  onClear: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  activeKeywords: string[];
  onSelectKeyword: (k: string) => void;
}) {
  const levelClass = (l: LogLevel) =>
    l === "success"
      ? "text-emerald-600"
      : l === "error"
      ? "text-rose-600"
      : l === "warn"
      ? "text-amber-600"
      : "text-[var(--text-secondary)]";

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              busy ? "animate-pulse bg-blue-400" : "bg-emerald-400"
            }`}
          />
          <span className="font-semibold">
            {busy ? "수집 중" : "완료"}
            <span className="ml-1 text-xs text-[var(--text-muted)]">
              · &quot;{keyword}&quot;
            </span>
            {progress.step && ` · ${phaseLabel(progress.step)}`}
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            {progress.percent}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          {activeKeywords.length > 1 && (
            <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
              <span>다른 진행:</span>
              {activeKeywords
                .filter((k) => k !== keyword)
                .slice(0, 3)
                .map((k) => (
                  <button
                    key={k}
                    onClick={() => onSelectKeyword(k)}
                    className="rounded bg-[var(--bg-elev)] px-2 py-0.5 hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
                  >
                    {k}
                  </button>
                ))}
            </div>
          )}
          {!busy && (
            <button
              onClick={onClear}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              로그 지우기
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-[var(--bg-elev)]">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-300"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      {/* Log lines */}
      <div
        ref={scrollRef}
        className="max-h-72 overflow-y-auto rounded-md bg-[var(--bg-base)] p-3 font-mono text-[11px] leading-relaxed"
      >
        {logs.length === 0 ? (
          <div className="text-[var(--text-muted)]">로그 대기 중...</div>
        ) : (
          logs.map((line, i) => (
            <div key={i} className={levelClass(line.level)}>
              <span className="text-[var(--text-muted)]">
                [{line.time.toLocaleTimeString("ko-KR")}]
              </span>{" "}
              {line.msg}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function SortHeader({
  label,
  sortKey,
  thisKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: AdSortKey;
  thisKey: AdSortKey;
  sortDir: SortDir;
  onSort: (key: AdSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === thisKey;
  return (
    <th
      className={`px-2 py-2 ${
        align === "right" ? "text-right" : "text-left"
      } font-semibold`}
    >
      <button
        onClick={() => onSort(thisKey)}
        className={`inline-flex items-center gap-1 transition ${
          active
            ? "text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        }`}
      >
        {label}
        <span className="text-[10px]">
          {active ? (sortDir === "desc" ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </th>
  );
}

function AdsTable({
  groups,
  sortKey,
  sortDir,
  onSort,
  onDissect,
  analyzeDays,
}: {
  groups: { primary: Ad; siblings: Ad[]; count: number }[];
  sortKey: AdSortKey;
  sortDir: SortDir;
  onSort: (key: AdSortKey) => void;
  onDissect?: (youtubeId: string, creativeId: string | null) => void;
  analyzeDays: AnalyzeDays;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-card)] px-6 py-16 text-center text-sm text-[var(--text-muted)]">
        아직 불러온 광고가 없어요. 위에 브랜드명이나 도메인을 넣어보세요.
        <div className="mt-2 text-xs">예: 올리브영 · oliveyoung.co.kr</div>
      </div>
    );
  }
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-elev)] text-xs text-[var(--text-secondary)]">
            <tr>
              <th className="px-2 py-2 text-left font-semibold">#</th>
              <th className="px-2 py-2 text-left font-semibold">썸네일</th>
              <th className="px-2 py-2 text-left font-semibold">제목</th>
              <th className="px-2 py-2 text-left font-semibold">광고</th>
              <th className="px-2 py-2 text-left font-semibold">YouTube</th>
              <th className="px-2 py-2 text-left font-semibold">유형</th>
              <SortHeader
                label="D+N"
                sortKey={sortKey}
                thisKey="date"
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="조회수"
                sortKey={sortKey}
                thisKey="views"
                sortDir={sortDir}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label={
                  analyzeDays === "all"
                    ? "성장률"
                    : `성장률 ${analyzeDays}일`
                }
                sortKey={sortKey}
                thisKey="growth"
                sortDir={sortDir}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="회/일"
                sortKey={sortKey}
                thisKey="daily"
                sortDir={sortDir}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="상태"
                sortKey={sortKey}
                thisKey="status"
                sortDir={sortDir}
                onSort={onSort}
              />
            </tr>
          </thead>
          <tbody>
            {groups.map((g, i) => (
              <AdRow
                key={g.primary.id}
                group={g}
                index={i + 1}
                highlightDaily={sortKey === "daily"}
                highlightDelta={sortKey === "delta"}
                highlightGrowth={sortKey === "growth"}
                onDissect={onDissect}
                analyzeDays={analyzeDays}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * 소재 mp4 다운로드 버튼. /api/download 가 yt-dlp 로 받아온 파일을 그대로
 * 흘려주고, 여기서는 blob 으로 받아 저장을 트리거한다.
 *
 * <a download> 로 바로 걸지 않는 이유: 실패(yt-dlp 미설치·영상 비공개)를
 * 링크로는 알 수 없어서, 사용자가 눌러도 아무 일도 안 일어나는 것처럼
 * 보인다. fetch 로 받아서 상태(진행 중/실패)를 버튼에 표시한다.
 */
function DownloadButton({
  youtubeId,
  title,
}: {
  youtubeId: string;
  title: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function download() {
    if (state === "busy") return;
    setState("busy");
    try {
      const res = await fetch(
        `/api/download?youtubeId=${encodeURIComponent(
          youtubeId
        )}&name=${encodeURIComponent(title)}`
      );
      if (!res.ok) {
        const msg = await res
          .json()
          .then((j: { error?: string }) => j.error)
          .catch(() => null);
        throw new Error(msg || `서버 응답 ${res.status}`);
      }
      const blob = await res.blob();
      // Content-Disposition 의 filename* 을 그대로 쓰고 싶지만 fetch+blob
      // 경로에서는 브라우저가 안 읽어주므로 여기서 다시 만든다.
      const safe =
        title
          .replace(/[\\/:*?"<>|]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80) ||
        youtubeId;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safe}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setState("idle");
    } catch (e) {
      setState("error");
      alert(`다운로드 실패\n\n${(e as Error).message}`);
      setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <button
      onClick={download}
      disabled={state === "busy"}
      title={
        state === "busy"
          ? "받는 중… 영상 길이에 따라 10~60초"
          : "이 소재를 mp4 로 저장 (yt-dlp 필요)"
      }
      className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-xs transition ${
        state === "error"
          ? "bg-rose-500/15 text-rose-600"
          : "text-[var(--text-muted)] hover:bg-teal-500/15 hover:text-teal-700"
      } disabled:cursor-wait disabled:opacity-60`}
    >
      {state === "busy" ? "⏳" : state === "error" ? "⚠️" : "⬇"}
    </button>
  );
}

function AdRow({
  group,
  index,
  highlightDaily = false,
  highlightDelta = false,
  highlightGrowth = false,
  onDissect,
  analyzeDays,
}: {
  group: { primary: Ad; siblings: Ad[]; count: number };
  index: number;
  highlightDaily?: boolean;
  highlightDelta?: boolean;
  highlightGrowth?: boolean;
  onDissect?: (youtubeId: string, creativeId: string | null) => void;
  analyzeDays: AnalyzeDays;
}) {
  const ad = group.primary;
  const hasYt = !!ad.youtubeId;
  const dpd = dailyViews(ad.ytViews, ad.ytPublishedAt);
  const dN = dPlusN(ad.firstSeen);
  const change = viewsChange(ad, analyzeDays);
  const classes = classifyAd(ad);
  // Title preference: YouTube title → ad long headline → ad headline → fallback.
  // 카피 추출 실패한 경우 (image 광고 다수) 사용자에게 "추출 실패" 명시.
  // 광고주 이름 그대로 + "광고" 라고 쓰면 사용자가 "추출 실패인지, 진짜 제목인지"
  // 구분 못함 → 신뢰도 떨어짐. 명시적 라벨로 정직하게.
  const hasRealTitle =
    !!(ad.ytTitle || ad.adLongHeadline || ad.adHeadline);
  const title = hasRealTitle
    ? (ad.ytTitle ?? ad.adLongHeadline ?? ad.adHeadline)!
    : ad.type === "image"
    ? "🖼 이미지 광고 (텍스트 없음 — ATC 보기)"
    : "📝 카피 추출 실패 — ATC 보기";
  // Subtitle = the OTHER text we have (don't repeat what's already in title)
  const subtitleParts: string[] = [];
  if (
    ad.adHeadline &&
    ad.adHeadline !== title &&
    ad.adHeadline !== ad.adLongHeadline
  )
    subtitleParts.push(ad.adHeadline);
  if (ad.adDescription && ad.adDescription !== title)
    subtitleParts.push(ad.adDescription);
  const subtitle = subtitleParts.join(" · ");
  const variantCount = group.count;

  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--bg-elev)]">
      <td className="px-2 py-1.5 text-[var(--text-muted)]">{index}</td>
      <td className="px-2 py-1.5">
        <ThumbnailCell ad={ad} />
      </td>
      <td className="max-w-md px-2 py-1.5">
        <div className="flex items-start gap-1.5">
          <div className="line-clamp-2 text-[13px] font-medium text-[var(--text-primary)]">
            {title}
          </div>
          {variantCount > 1 && (
            <span
              className="shrink-0 rounded-full bg-pink-500/20 px-1.5 py-0.5 text-[10px] font-bold text-pink-700"
              title={`이 영상이 ${variantCount}개의 광고 크리에이티브로 사용 중`}
            >
              🎬{variantCount}
            </span>
          )}
        </div>
        {ad.advertiserName && (
          <div className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
            <span className="text-[10px] text-[var(--text-muted)]">광고주:</span>{" "}
            <span className="font-medium">{ad.advertiserName}</span>
            {isShellAd(ad) && (
              <span
                className="ml-1.5 inline-flex items-center rounded-full bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-bold text-cyan-700"
                title="투명성 센터 도메인 인덱스에 안 잡히는 대행 채널 광고. YouTube 채널 업로드 목록에서 찾아낸 것."
              >
                🐤 shell
              </span>
            )}
            {ad.ytChannel && ad.ytChannel !== ad.advertiserName && (
              <>
                <span className="mx-1.5 text-[var(--text-muted)]">·</span>
                <span className="text-[10px] text-[var(--text-muted)]">채널:</span>{" "}
                <span className="text-[var(--text-secondary)]">
                  {ad.ytChannel}
                </span>
              </>
            )}
          </div>
        )}
        {subtitle && (
          <div
            className="mt-0.5 line-clamp-3 text-[11px] italic text-[var(--text-muted)]"
            title={`광고 카피: ${subtitle}`}
          >
            <span className="not-italic text-[10px]">📝</span> {subtitle}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1.5">
        {variantCount === 1 ? (
          <a
            href={atcLink(ad)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-amber-600 hover:text-amber-700 hover:underline"
          >
            보기
          </a>
        ) : (
          <details className="group relative">
            <summary
              className="cursor-pointer whitespace-nowrap text-xs text-amber-600 hover:text-amber-700 hover:underline"
              title={`이 영상이 ${variantCount}개 크리에이티브로 사용 중`}
            >
              {variantCount}개 ▾
            </summary>
            <div className="absolute right-0 z-10 mt-1 max-h-64 min-w-32 overflow-y-auto rounded-md border border-[var(--border-strong)] bg-[var(--bg-elev)] p-2 shadow-lg">
              {group.siblings.map((s, i) => (
                <a
                  key={s.id}
                  href={atcLink(s)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block whitespace-nowrap px-2 py-1 text-[11px] text-amber-700 hover:bg-[var(--bg-card)] hover:text-amber-200"
                >
                  광고 #{i + 1} ({s.creativeId.slice(2, 10)}...)
                </a>
              ))}
            </div>
          </details>
        )}
        {hasYt && (
          <DownloadButton youtubeId={ad.youtubeId!} title={title} />
        )}
        </div>
      </td>
      <td className="px-2 py-1.5">
        {hasYt ? (
          <div className="flex items-center gap-1">
            <a
              href={ytLink(ad.youtubeId!)}
              target="_blank"
              rel="noopener noreferrer"
              title="YouTube에서 보기"
              className="inline-flex items-center justify-center rounded-md bg-rose-500/15 p-1.5 text-rose-600 hover:bg-rose-500/30"
            >
              🎬
            </a>
            {onDissect && (
              <button
                onClick={() =>
                  onDissect(ad.youtubeId!, ad.creativeId ?? null)
                }
                title="똑같이만들기 — 자막+컷+썸네일 자동 분해"
                className="inline-flex items-center justify-center rounded-md bg-indigo-500/15 p-1.5 text-indigo-700 hover:bg-indigo-500/30"
              >
                ✂️
              </button>
            )}
          </div>
        ) : (
          <span className="text-[var(--text-muted)]">-</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        <TypeBadge ad={ad} />
      </td>
      {/* D+N + 게시일 합쳐서 한 셀. whitespace-nowrap으로 줄바꿈 방지. */}
      <td className="whitespace-nowrap px-2 py-1.5 text-xs">
        {dN !== null ? (
          <div className="font-semibold text-[var(--text-primary)]">
            D+{dN}
          </div>
        ) : (
          <div className="text-[var(--text-muted)]">-</div>
        )}
        <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
          {ad.ytPublishedAt ?? formatUnixDate(ad.firstSeen)}
        </div>
      </td>
      {/* 조회수 — "회" 단위 제거 (헤더에 이미 표시). 큰 숫자는 K/M 축약. */}
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
        {hasYt && ad.ytViews !== null ? (
          <span
            className="font-medium text-[var(--text-primary)]"
            title={`${ad.ytViews.toLocaleString()}회`}
          >
            {formatCompactNum(ad.ytViews)}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">-</span>
        )}
      </td>
      {/* 성장률 셀 — 분석 기간 내 % 변화(메인) + before→after(보조).
          변화·성장률 중복이라 한 컬럼으로 통합. +300%↑엔 🔥. AdStat
          스냅샷 2개+ 있어야 계산 (매일 cron 누적). */}
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-xs">
        {change.hasData ? (
          <>
            <div
              className={
                change.percent > 0
                  ? highlightGrowth
                    ? "font-bold text-emerald-600"
                    : "font-semibold text-emerald-700"
                  : change.percent < 0
                  ? "font-semibold text-rose-700"
                  : "text-[var(--text-secondary)]"
              }
              title={`평균 ${change.avgPerDay >= 0 ? "+" : ""}${change.avgPerDay.toLocaleString()}/일 (${change.daysSpan}일)`}
            >
              {change.percent >= 300 && "🔥 "}
              {change.percent > 0 ? "+" : ""}
              {change.percent.toFixed(1)}%
            </div>
            <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
              {formatCompactNum(change.before)} → {formatCompactNum(change.after)}
            </div>
          </>
        ) : (
          <span
            className="text-[var(--text-muted)]"
            title="AdStat 스냅샷 2개 이상 쌓여야 성장률 표시 (매일 새벽 3시 자동 누적)"
          >
            —
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
        {hasYt && ad.ytViews !== null ? (
          <span
            className={
              highlightDaily
                ? "font-bold text-amber-600"
                : "text-[var(--text-secondary)]"
            }
            title={`${dpd.toLocaleString()}회/일`}
          >
            {formatCompactNum(dpd)}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">-</span>
        )}
      </td>
      {/* 상태 — classifyAd가 반환하는 분류 배지를 가로로. 최대 3개 표시. */}
      <td className="px-2 py-1.5">
        {classes.length === 0 ? (
          <span className="text-[10px] text-[var(--text-muted)]">—</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {classes.slice(0, 3).map((c) => {
              const m = CLASSIFICATION_META[c];
              return (
                <span
                  key={c}
                  title={m.tip}
                  className={`rounded-full ${m.bg} px-1.5 py-0.5 text-[10px] font-bold ${m.text}`}
                >
                  {m.emoji} {m.label}
                </span>
              );
            })}
          </div>
        )}
      </td>
    </tr>
  );
}

function ThumbnailCell({ ad }: { ad: Ad }) {
  // 썸네일 크기 — 이전 56×96 (h-14 w-24) 너무 작아서 사용자가 광고 카피
  // (이미지 안에 그려진 텍스트) 인식 불가능. ATC 자체가 카피 텍스트를
  // 별도 노출 안 하므로 썸네일이 카피의 유일한 representation.
  // 96×160 (h-16 w-28) 으로 키워서 광고 자체를 "읽을 수 있게" 만듦.
  // image 광고는 object-contain 으로 텍스트 안 잘리게.
  if (ad.youtubeId) {
    return (
      <a
        href={ytLink(ad.youtubeId)}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        <img
          src={ytThumbnail(ad.youtubeId)}
          alt=""
          className="h-16 w-28 rounded object-cover"
          loading="lazy"
        />
      </a>
    );
  }
  if (ad.type === "image" && ad.imageHtml) {
    return (
      <a
        href={atcLink(ad)}
        target="_blank"
        rel="noopener noreferrer"
        className="block h-16 w-28 overflow-hidden rounded bg-[var(--bg-elev)]"
        title="투명성 센터에서 크게 보기"
      >
        <div
          className="flex h-full w-full items-center justify-center [&>img]:max-h-full [&>img]:max-w-full [&>img]:object-contain"
          dangerouslySetInnerHTML={{ __html: ad.imageHtml }}
        />
      </a>
    );
  }
  if (ad.previewImage) {
    return (
      <a
        href={atcLink(ad)}
        target="_blank"
        rel="noopener noreferrer"
        className="block h-16 w-28 overflow-hidden rounded bg-[var(--bg-elev)]"
        title="투명성 센터에서 크게 보기"
      >
        <img
          src={ad.previewImage}
          alt=""
          className="h-full w-full object-contain"
          loading="lazy"
        />
      </a>
    );
  }
  return (
    <div className="flex h-16 w-28 items-center justify-center rounded bg-[var(--bg-elev)] text-[var(--text-muted)]">
      <span className="text-3xl">{ad.type === "video" ? "🎬" : "📦"}</span>
    </div>
  );
}

function TypeBadge({ ad }: { ad: Ad }) {
  // Short, single-line labels — long labels like "리치미디어/동영상" wrap
  // onto 2-3 lines when the table cell is narrow, ruining readability.
  // 호버 시 tooltip으로 풀 명칭 표시.
  if (ad.youtubeId)
    return (
      <span
        title="리치미디어/동영상 (YouTube 매칭)"
        className="inline-block whitespace-nowrap rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-700"
      >
        🎬 영상
      </span>
    );
  if (ad.type === "image")
    return (
      <span className="inline-block whitespace-nowrap rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
        🖼 이미지
      </span>
    );
  if (ad.type === "video")
    return (
      <span
        title="직접업로드 (YouTube에 없음)"
        className="inline-block whitespace-nowrap rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold text-violet-700"
      >
        📤 직업로드
      </span>
    );
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-slate-500/20 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
      기타
    </span>
  );
}

function CreativesView({
  pool,
  sort,
  sortDir,
  onSort,
  classFilter,
  onClassFilterChange,
  domains,
  domainFilter,
  onDomainFilterChange,
}: {
  pool: { primary: Ad; siblings: Ad[]; count: number }[];
  sort: CreativesSort;
  sortDir: SortDir;
  onSort: (s: CreativesSort) => void;
  classFilter: Classification | "all";
  onClassFilterChange: (c: Classification | "all") => void;
  domains: { keyword: string; count: number }[];
  domainFilter: string | null;
  onDomainFilterChange: (d: string | null) => void;
}) {
  // 소재풀 전용 필터 — 조회수 대역 / 소재 나이 / 제목·업체 검색.
  // 레퍼런스 도구 "소재만보기" 벤치마크 (2026-07-13). 탭 안에서 self-contained.
  const [poolViewBand, setPoolViewBand] = useState("");
  const [poolAgeBand, setPoolAgeBand] = useState("");
  const [poolSearch, setPoolSearch] = useState("");

  // Compute classifications and counts up front so we can filter the table
  // and badge each chip with how many ads match.
  const classified = useMemo(
    () =>
      pool.map((g) => ({
        ...g,
        classes: classifyAd(g.primary),
      })),
    [pool]
  );
  const classCounts: Record<Classification, number> = {
    신규광고: 0,
    신규영상: 0,
    히어로: 0,
    가속도: 0,
    스파이크: 0,
    피로도: 0,
  };
  for (const r of classified) {
    for (const c of r.classes) classCounts[c]++;
  }
  const filtered = useMemo(() => {
    return classified.filter((r) => {
      if (classFilter !== "all" && !r.classes.includes(classFilter))
        return false;
      const a = r.primary;
      // 조회수 대역 "min:max"
      if (poolViewBand) {
        const [minS, maxS] = poolViewBand.split(":");
        const v = a.ytViews;
        if (v == null) return false;
        if (minS && v < parseInt(minS, 10)) return false;
        if (maxS && v >= parseInt(maxS, 10)) return false;
      }
      // 소재 나이 "old:N" — firstSeen N일+ = 롱런/스테디셀러
      if (poolAgeBand.startsWith("old:")) {
        const minDays = parseInt(poolAgeBand.slice(4), 10);
        if (!a.firstSeen) return false;
        const ageDays =
          (Date.now() - parseInt(a.firstSeen, 10) * 1000) / 86400000;
        if (ageDays < minDays) return false;
      }
      // 제목/업체(키워드/채널) 검색
      if (poolSearch.trim()) {
        const q = poolSearch.trim().toLowerCase();
        const hay = [a.ytTitle, a.ytChannel, a.keyword, a.advertiserName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [classified, classFilter, poolViewBand, poolAgeBand, poolSearch]);

  // 상단 지표 4개 — 레퍼런스 도구 스타일. 캠페인 합 = count 합 (같은 영상
  // 재사용 포함), 고유 영상 = dedup 후 행 수.
  const poolStats = useMemo(() => {
    let campaigns = 0;
    let viewsSum = 0;
    const owners = new Set<string>();
    for (const r of filtered) {
      campaigns += r.count;
      viewsSum += r.primary.ytViews ?? 0;
      owners.add(r.primary.keyword);
    }
    return { campaigns, unique: filtered.length, viewsSum, owners: owners.size };
  }, [filtered]);

  if (pool.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-card)] px-6 py-16 text-center text-sm text-[var(--text-muted)]">
        아직 영상 광고가 하나도 없어요.
        <div className="mt-2 text-xs">
          위 검색창에 도메인이나 브랜드명을 먼저 넣어보세요. (예: 올리브영)
        </div>
      </div>
    );
  }
  return (
    <>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <h2 className="mb-2 text-sm font-semibold">📈 소재 분석 (전체 누적)</h2>
        <p className="text-xs text-[var(--text-muted)]">
          지금까지 불러온 <b>모든 도메인의 영상 광고를 한 화면에서</b> 봅니다.
          같은 영상은 한 줄로 묶이고, 며칠에 걸쳐 다시 불러올수록 일별 조회수가
          쌓여서 <b>상승세 · 급등 · 둔화</b>가 자동으로 붙어요. 아래{" "}
          <b>광고주 필터</b>로 도메인 하나만 보거나, 사이드바 ⭐로 매일 자동
          갱신되게 할 수 있습니다.
        </p>
      </section>

      {/* 상단 지표 4개 — 레퍼런스 도구 "소재만보기" 스타일. 필터 반영 실시간. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "광고 캠페인", value: poolStats.campaigns, hint: "같은 영상 재사용 포함" },
          { label: "고유 영상 (dedup)", value: poolStats.unique, hint: "YouTube 영상 기준" },
          { label: "조회수 합계", value: poolStats.viewsSum, hint: "고유 영상 합", format: true },
          { label: "업체 수", value: poolStats.owners, hint: "keyword 기준" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3"
          >
            <div className="text-[11px] text-[var(--text-muted)]">{s.label}</div>
            <div className="text-xl font-bold text-[var(--text-primary)]">
              {s.format ? formatCompactNum(s.value) : s.value.toLocaleString()}
            </div>
            <div className="text-[10px] text-[var(--text-muted)]/70">{s.hint}</div>
          </div>
        ))}
      </div>

      {/* 소재풀 필터 행 — 조회수 대역 / 나이 / 캠페인수 정렬 / 검색 */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={poolViewBand}
          onChange={(e) => setPoolViewBand(e.target.value)}
          className={`rounded-md border px-2 py-1 text-[11px] outline-none ${
            poolViewBand
              ? "border-indigo-500 bg-indigo-500/10 font-semibold text-indigo-700"
              : "border-[var(--border-strong)] bg-[var(--bg-elev)] text-[var(--text-secondary)]"
          }`}
        >
          <option value="">👁️ 조회수 전체</option>
          <option value="0:30000">~3만 (테스트)</option>
          <option value="30000:300000">3만~30만</option>
          <option value="300000:3000000">30만~300만 (통한 소재)</option>
          <option value="3000000:20000000">300만~2000만 (대형)</option>
          <option value="20000000:">2000만+ (전국구)</option>
        </select>
        <select
          value={poolAgeBand}
          onChange={(e) => setPoolAgeBand(e.target.value)}
          className={`rounded-md border px-2 py-1 text-[11px] outline-none ${
            poolAgeBand
              ? "border-emerald-500 bg-emerald-500/10 font-semibold text-emerald-700"
              : "border-[var(--border-strong)] bg-[var(--bg-elev)] text-[var(--text-secondary)]"
          }`}
        >
          <option value="">⏳ 나이 전체</option>
          <option value="old:21">3주+ (살아남은 소재)</option>
          <option value="old:60">2개월+ (검증된 소재)</option>
        </select>
        <button
          onClick={() => onSort("campaigns")}
          className={`rounded-md border px-2 py-1 text-[11px] transition ${
            sort === "campaigns"
              ? "border-amber-500 bg-amber-500/10 font-semibold text-amber-700"
              : "border-[var(--border-strong)] bg-[var(--bg-elev)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
          }`}
          title="같은 영상이 몇 개 광고 캠페인에 재사용됐나 — 많을수록 광고주가 돈 들여 검증한 소재"
        >
          📦 캠페인 수 많은순 {sort === "campaigns" ? (sortDir === "desc" ? "↓" : "↑") : ""}
        </button>
        <input
          value={poolSearch}
          onChange={(e) => setPoolSearch(e.target.value)}
          placeholder="🔍 제목 / 업체명 검색..."
          className="ml-auto w-56 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
        />
      </div>

      {/* Domain filter — opt-in scoping for this tab */}
      {domains.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[var(--text-secondary)]">
            광고주 필터:
          </span>
          <button
            onClick={() => onDomainFilterChange(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              domainFilter === null
                ? "bg-emerald-500 text-slate-900"
                : "border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
            }`}
          >
            전체 ({domains.reduce((s, d) => s + d.count, 0)})
          </button>
          {domains.map((d) => (
            <button
              key={d.keyword}
              onClick={() =>
                onDomainFilterChange(domainFilter === d.keyword ? null : d.keyword)
              }
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                domainFilter === d.keyword
                  ? "bg-emerald-500 text-slate-900"
                  : "border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
              }`}
            >
              {d.keyword}{" "}
              <span className="opacity-60">({d.count})</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm text-[var(--text-secondary)]">
          영상{" "}
          <span className="text-lg font-bold text-emerald-600">
            {filtered.length}
          </span>
          개
          {classFilter !== "all" && (
            <span className="ml-2 text-xs text-[var(--text-muted)]">
              / 전체 {pool.length}개
            </span>
          )}
        </div>
        <button
          onClick={() => onSort("views")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            sort === "views"
              ? "bg-emerald-500 text-slate-900"
              : "border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20"
          }`}
        >
          📊 누적 조회수
        </button>
        <button
          onClick={() => onSort("daily")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            sort === "daily"
              ? "bg-amber-500 text-slate-900"
              : "border border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20"
          }`}
        >
          ⚡ 일평균 조회수
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[var(--text-secondary)]">
          분류:
        </span>
        <button
          onClick={() => onClassFilterChange("all")}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
            classFilter === "all"
              ? "bg-slate-200 text-slate-900"
              : "border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
          }`}
        >
          전체
        </button>
        {(
          [
            "신규광고",
            "신규영상",
            "히어로",
            "가속도",
            "스파이크",
            "피로도",
          ] as Classification[]
        ).map((c) => {
          const meta = CLASSIFICATION_META[c];
          const active = classFilter === c;
          const count = classCounts[c];
          return (
            <button
              key={c}
              onClick={() => onClassFilterChange(active ? "all" : c)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                active
                  ? `${meta.bg} ${meta.text} ring-1 ring-current`
                  : `border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]`
              }`}
              disabled={count === 0}
              title={count === 0 ? `${meta.label}: 해당 없음` : meta.tip}
            >
              {meta.emoji} {meta.label}{" "}
              <span className="opacity-60">{count}</span>
            </button>
          );
        })}
        <span className="ml-2 text-[10px] text-[var(--text-muted)]">
          ※ 가속도/스파이크/피로도는 일별 스냅샷이 2개 이상 쌓여야 분류됩니다
        </span>
      </div>

      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-elev)] text-xs text-[var(--text-secondary)]">
              <tr>
                <th className="px-2 py-2 text-left font-semibold">#</th>
                <th className="px-2 py-2 text-left font-semibold">썸네일</th>
                <th className="px-2 py-2 text-left font-semibold">제목</th>
                <th className="px-2 py-2 text-left font-semibold">분류</th>
                <th className="px-2 py-2 text-left font-semibold">광고주</th>
                <th className="px-2 py-2 text-left font-semibold">YT</th>
                <CreativesSortHeader
                  label="게시일"
                  thisKey="date"
                  sort={sort}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <CreativesSortHeader
                  label="조회수"
                  thisKey="views"
                  sort={sort}
                  sortDir={sortDir}
                  onSort={onSort}
                  align="right"
                />
                <CreativesSortHeader
                  label="회/일"
                  thisKey="daily"
                  sort={sort}
                  sortDir={sortDir}
                  onSort={onSort}
                  align="right"
                />
                <th className="px-2 py-2 text-left font-semibold">7일 추이</th>
                <CreativesSortHeader
                  label="좋아요"
                  thisKey="likes"
                  sort={sort}
                  sortDir={sortDir}
                  onSort={onSort}
                  align="right"
                />
              </tr>
            </thead>
            <tbody>
              {filtered.map((g, i) => {
                const ad = g.primary;
                const dpd = dailyViews(ad.ytViews, ad.ytPublishedAt);
                return (
                  <tr
                    key={ad.id}
                    className="border-t border-[var(--border)] hover:bg-[var(--bg-elev)]"
                  >
                    <td className="px-2 py-1.5 text-[var(--text-muted)]">
                      {i + 1}
                    </td>
                    <td className="px-2 py-1.5">
                      <ThumbnailCell ad={ad} />
                    </td>
                    <td className="max-w-md px-2 py-1.5">
                      <div className="flex items-start gap-1.5">
                        <div className="line-clamp-2 text-[13px] font-medium text-[var(--text-primary)]">
                          {ad.ytTitle ?? "(제목 없음)"}
                        </div>
                        {g.count > 1 && (
                          <span className="shrink-0 rounded-full bg-pink-500/20 px-1.5 py-0.5 text-[10px] font-bold text-pink-700">
                            🎬{g.count}
                          </span>
                        )}
                      </div>
                      {(ad.adHeadline || ad.adDescription) && (
                        <div
                          className="mt-0.5 line-clamp-1 text-[11px] italic text-[var(--text-muted)]"
                          title={
                            "광고 카피: " +
                            [ad.adHeadline, ad.adDescription]
                              .filter(Boolean)
                              .join(" · ")
                          }
                        >
                          <span className="not-italic text-[10px]">📝</span>{" "}
                          {[ad.adHeadline, ad.adDescription]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {g.classes.length === 0 ? (
                          <span className="text-[10px] text-[var(--text-muted)]">
                            -
                          </span>
                        ) : (
                          g.classes.map((c) => {
                            const m = CLASSIFICATION_META[c];
                            return (
                              <span
                                key={c}
                                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${m.bg} ${m.text}`}
                              >
                                {m.emoji} {m.label}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      <div className="font-medium text-[var(--text-primary)]">
                        {ad.advertiserName || "-"}
                      </div>
                      <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                        🌐 {ad.keyword}
                      </div>
                      {ad.ytChannel && ad.ytChannel !== ad.advertiserName && (
                        <div className="text-[10px] text-[var(--text-secondary)]">
                          📺 {ad.ytChannel}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <a
                        href={ytLink(ad.youtubeId!)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-md bg-rose-500/15 p-1.5 text-rose-600 hover:bg-rose-500/30"
                      >
                        🎬
                      </a>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-[var(--text-secondary)]">
                      {ad.ytPublishedAt ?? "-"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <span
                        className={
                          sort === "views"
                            ? "font-bold text-[var(--text-primary)]"
                            : "text-[var(--text-primary)]"
                        }
                      >
                        {(ad.ytViews ?? 0).toLocaleString()}회
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <span
                        className={
                          sort === "daily"
                            ? "font-bold text-amber-600"
                            : "text-[var(--text-secondary)]"
                        }
                      >
                        {dpd.toLocaleString()}회
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <Sparkline stats={ad.stats ?? []} />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">
                      {(ad.ytLikes ?? 0).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function CreativesSortHeader({
  label,
  thisKey,
  sort,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  thisKey: CreativesSort;
  sort: CreativesSort;
  sortDir: SortDir;
  onSort: (k: CreativesSort) => void;
  align?: "left" | "right";
}) {
  const active = sort === thisKey;
  return (
    <th
      className={`px-2 py-2 ${
        align === "right" ? "text-right" : "text-left"
      } font-semibold`}
    >
      <button
        onClick={() => onSort(thisKey)}
        className={`inline-flex items-center gap-1 transition ${
          active
            ? "text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        }`}
      >
        {label}
        <span className="text-[10px]">
          {active ? (sortDir === "desc" ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </th>
  );
}

/**
 * Tiny inline SVG sparkline of the last N days' view count.
 * Shows "더 필요" when only one snapshot exists.
 */
function Sparkline({ stats }: { stats: AdStat[] }) {
  if (stats.length === 0) {
    return <span className="text-[10px] text-[var(--text-muted)]">-</span>;
  }
  if (stats.length === 1) {
    return (
      <span
        className="text-[10px] text-[var(--text-muted)]"
        title="데이터 1개. 매일 검색하면 추세선이 그려져요."
      >
        스냅샷 1개
      </span>
    );
  }
  const sorted = [...stats].sort(
    (a, b) =>
      new Date(a.capturedDate).getTime() - new Date(b.capturedDate).getTime()
  );
  const values = sorted.map((s) => s.views);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 80;
  const H = 24;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / range) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const lastDelta = values[values.length - 1] - values[values.length - 2];
  const stroke =
    lastDelta > 0 ? "#10b981" : lastDelta < 0 ? "#f43f5e" : "#94a3b8";
  return (
    <div
      className="flex items-center gap-1.5"
      title={sorted
        .map((s) => `${s.capturedDate}: ${s.views.toLocaleString()}회`)
        .join("\n")}
    >
      <svg width={W} height={H} className="overflow-visible">
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
          points={pts}
        />
      </svg>
      <span
        className={`text-[10px] tabular-nums ${
          lastDelta > 0
            ? "text-emerald-600"
            : lastDelta < 0
            ? "text-rose-600"
            : "text-[var(--text-muted)]"
        }`}
      >
        {lastDelta > 0 ? "+" : ""}
        {lastDelta.toLocaleString()}
      </span>
    </div>
  );
}

function VideosTable({
  videos,
  sortKey,
  sortDir,
  onSort,
}: {
  videos: Video[];
  sortKey: AdSortKey;
  sortDir: SortDir;
  onSort: (key: AdSortKey) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-elev)] text-xs text-[var(--text-secondary)]">
            <tr>
              <th className="px-2 py-2 text-left font-semibold">#</th>
              <th className="px-2 py-2 text-left font-semibold">제목</th>
              <th className="px-2 py-2 text-left font-semibold">채널</th>
              <th className="px-2 py-2 text-left font-semibold">키워드</th>
              <th className="px-2 py-2 text-left font-semibold">유형</th>
              <SortHeader
                label="게시일"
                sortKey={sortKey}
                thisKey="date"
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="조회수"
                sortKey={sortKey}
                thisKey="views"
                sortDir={sortDir}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="좋아요"
                sortKey={sortKey}
                thisKey="likes"
                sortDir={sortDir}
                onSort={onSort}
                align="right"
              />
              <SortHeader
                label="댓글"
                sortKey={sortKey}
                thisKey="comments"
                sortDir={sortDir}
                onSort={onSort}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {videos.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-12 text-center text-sm text-[var(--text-muted)]"
                >
                  YouTube 검색 결과가 없습니다.
                </td>
              </tr>
            ) : (
              videos.map((v, i) => (
                <tr
                  key={v.id}
                  className="border-t border-[var(--border)] hover:bg-[var(--bg-elev)]"
                >
                  <td className="px-2 py-1.5 text-[var(--text-muted)]">{i + 1}</td>
                  <td className="max-w-md px-2 py-1.5">
                    <div className="flex items-start gap-2">
                      {v.thumbnail && (
                        <img
                          src={v.thumbnail}
                          alt=""
                          className="h-12 w-20 shrink-0 rounded object-cover"
                          loading="lazy"
                        />
                      )}
                      <a
                        href={v.youtube}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="line-clamp-2 font-medium text-[var(--text-primary)] hover:text-rose-600"
                      >
                        {v.title}
                      </a>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-[var(--text-secondary)]">
                    {v.channel}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-[var(--text-muted)]">
                    {v.keyword}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        v.type === "쇼츠"
                          ? "bg-violet-500/20 text-violet-700"
                          : "bg-slate-500/20 text-slate-700"
                      }`}
                    >
                      {v.type}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-[var(--text-secondary)]">
                    {v.publishedAt}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {v.views.toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {v.likes.toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {v.comments.toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
