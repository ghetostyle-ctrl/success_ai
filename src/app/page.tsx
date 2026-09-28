"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import dynamic from "next/dynamic";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bird,
  Calendar,
  Camera,
  ChartNoAxesColumn,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  CircleCheck,
  CircleHelp,
  CircleX,
  Clapperboard,
  Copy,
  Database,
  Download,
  FileText,
  Film,
  Flame,
  Globe,
  Hourglass,
  Image as ImageIcon,
  Info,
  Layers,
  SlidersHorizontal,
  LayoutDashboard,
  LayoutList,
  LoaderCircle,
  Megaphone,
  Package,
  Plus,
  Radio,
  RefreshCw,
  Rocket,
  Scissors,
  Search,
  Sprout,
  Star,
  Tag,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Tv,
  Upload,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
// 첫 진입 tab='ads' 만 보임. 나머지 view 는 dynamic import 로 lazy —
// 사용자가 그 tab 클릭 시 그제서야 chunk 다운로드.
const DashboardView = dynamic(() => import("@/components/DashboardView"), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-base text-[var(--text-muted)]">대시보드 로딩…</div>,
});
import BrandArchive, { type ArchiveBrand } from "@/components/BrandArchive";
import { AdSearchBox } from "@/components/AdSearchBox";
import { AdCardGrid } from "@/components/AdCardGrid";
import { AdSelectionToolbar } from "@/components/AdSelectionToolbar";
import { confirmDialog } from "@/lib/confirm-dialog";

const GuideView = dynamic(() => import("@/components/GuideView"), {
  ssr: false,
  loading: () => (
    <div className="p-8 text-center text-base text-[var(--text-muted)]">
      사용법 로딩…
    </div>
  ),
});
const MetaView = dynamic(() => import("@/components/MetaView"), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-base text-[var(--text-muted)]">메타 로딩…</div>,
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
// 스위트 v1: A1 danger / A2 warning / A3 neutral 배지 톤. 점도 같은 의미색
// (브랜드 목록이 v2 에서 밝은 본문 패널로 옮겨 왔다).
const TIER_META: Record<string, { label: string; dot: string; chip: string }> = {
  A1: { label: "A1", dot: "bg-danger", chip: "badge badge-danger" },
  A2: { label: "A2", dot: "bg-warning", chip: "badge badge-warning" },
  A3: { label: "A3", dot: "bg-faint", chip: "badge badge-neutral" },
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
  { Icon: LucideIcon; label: string; tip: string; bg: string; text: string }
> = {
  신규광고: {
    Icon: Sprout,
    label: "새 캠페인",
    tip: "이 광고가 투명성 센터에 처음 잡힌 지 10일 이내. 영상 자체는 오래됐어도 집행은 새로 시작된 것.",
    bg: "bg-accent-soft",
    text: "text-accent-ink",
  },
  신규영상: {
    Icon: Film,
    label: "새 소재",
    tip: "YouTube 영상이 최근 21일 이내에 게시됨.",
    bg: "bg-accent-soft",
    text: "text-accent-ink",
  },
  히어로: {
    Icon: Star,
    label: "주력",
    tip: "누적 50만+ 조회수 AND 일평균 5천+ — 오래 밀고 있는 간판 소재.",
    bg: "bg-warning-soft",
    text: "text-warning",
  },
  가속도: {
    Icon: TrendingUp,
    label: "상승세",
    tip: "최근 3일 평균 증가량이 전체 평균의 1.25배 이상. (스냅샷 3+개 필요)",
    bg: "bg-success-soft",
    text: "text-success",
  },
  스파이크: {
    Icon: Zap,
    label: "급등",
    tip: "직전 대비 180% 이상 폭증. (스냅샷 2+개 필요)",
    bg: "bg-danger-soft",
    text: "text-danger",
  },
  피로도: {
    Icon: TrendingDown,
    label: "둔화",
    tip: "최근 3일 연속 증가량 하락. (스냅샷 3+개 필요)",
    bg: "bg-surface-soft",
    text: "text-muted",
  },
};

type Tab = "archive" | "ads" | "meta" | "creatives" | "dashboard" | "guide";

// 사이드바 nav · 브레드크럼 · 페이지 제목이 함께 쓰는 탭 이름과 아이콘.
const TAB_META: Record<Tab, { eyebrow: string; label: string; description: string; Icon: LucideIcon }> = {
  archive: {
    eyebrow: "레퍼런스 수집",
    label: "브랜드 아카이브",
    description: "불러온 브랜드를 카드로 모아 보고, 브랜드별 광고로 들어갑니다.",
    Icon: Archive,
  },
  ads: {
    eyebrow: "레퍼런스 수집",
    label: "구글 광고",
    description: "구글 광고 투명성 센터의 광고와 YouTube 영상 공개 통계를 함께 봅니다.",
    Icon: LayoutList,
  },
  meta: {
    eyebrow: "레퍼런스 수집",
    label: "메타 광고",
    description: "메타 광고 라이브러리에서 수집한 브랜드별 광고를 봅니다.",
    Icon: Megaphone,
  },
  creatives: {
    eyebrow: "분석",
    label: "소재 비교",
    description: "수집한 광고 소재를 조회수와 상태 분류로 비교합니다.",
    Icon: Clapperboard,
  },
  dashboard: {
    eyebrow: "분석",
    label: "대시보드",
    description: "기간별 수집 현황과 광고 추이를 한눈에 봅니다.",
    Icon: LayoutDashboard,
  },
  guide: {
    eyebrow: "도움말",
    label: "사용법",
    description: "Success AI로 광고 레퍼런스를 모으고 보는 방법입니다.",
    Icon: CircleHelp,
  },
};
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

function normalizeAdKeyword(query: string): string {
  const trimmed = query.trim();
  if (!looksLikeDomain(trimmed)) return trimmed;

  return trimmed
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*/, "");
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
    return "Google이 이 IP를 봇으로 의심 중 — 1~3시간 후 재시도";
  }
  if (s.includes("curl exit 28") || s.includes("timeout"))
    return "네트워크 timeout — 잠시 후 재시도";
  if (s.includes("curl exit 6") || s.includes("could not resolve"))
    return "DNS 해석 실패 — 네트워크 확인";
  if (s.includes("curl exit 56") || s.includes("connection reset"))
    return "연결 끊김 — 잠시 후 재시도";
  if (s.includes("fetch failed")) return "fetch 실패 — 네트워크 확인";
  // fallback: 80자 cap
  return raw.length > 80 ? raw.slice(0, 80) + "…" : raw;
}

/**
 * progress.step (server-side phase tag) → user-friendly label.
 * "atc" → "광고 페이지 수집 중", etc.
 */
/**
 * 태그별 색상 자동 배정 — 같은 태그는 어디서든 같은 색.
 * hash(tag) → 8개 팔레트 중 하나 (Tailwind classes). 칩은 중립이고 색은
 * 앞의 8px 점에만 쓴다 (스위트 v1).
 * 한국 사용자가 식이섬유/화장품/음료/건강식품 등으로 라벨링 시
 * chip + 카드 표시 모두 같은 색으로 일관성.
 */
const TAG_PALETTE = [
  { dot: "bg-[#d97706]" },
  { dot: "bg-[#e11d48]" },
  { dot: "bg-[#059669]" },
  { dot: "bg-[#7c3aed]" },
  { dot: "bg-[#0284c7]" },
  { dot: "bg-[#ea580c]" },
  { dot: "bg-[#db2777]" },
  { dot: "bg-[#0891b2]" },
] as const;
function tagColor(tag: string): (typeof TAG_PALETTE)[number] {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

function phaseLabel(step: string): string {
  switch (step) {
    case "starting":
      return "시작 중";
    case "atc":
      return "광고 페이지 수집 중";
    case "save":
      return "DB 저장 중";
    case "yt-extract":
      return "YouTube 영상 매칭 중";
    case "yt-stats":
      return "영상 통계 수집 중";
    case "done":
      return "완료";
    default:
      return step;
  }
}

/** progress.step → Lucide 아이콘 (phaseLabel 과 짝). 모르는 단계는 null. */
function phaseIcon(step: string): LucideIcon | null {
  switch (step) {
    case "starting":
      return Rocket;
    case "atc":
      return Radio;
    case "save":
      return Database;
    case "yt-extract":
      return Clapperboard;
    case "yt-stats":
      return ChartNoAxesColumn;
    case "done":
      return CircleCheck;
    default:
      return null;
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

  useEffect(() => {
    setDomainOnly(selectedKeyword ? looksLikeDomain(selectedKeyword) : false);
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
  const [adView, setAdView] = useState<"cards" | "table">("cards");
  const [selectedAdIds, setSelectedAdIds] = useState<Set<string>>(() => new Set());

  // 자동수집 위젯의 "누락" 펼침 토글 (브랜드 목록 패널)
  const [showMissing, setShowMissing] = useState(false);
  // 브랜드 목록 패널 펼침 상태 — 탭마다 따로 기억한다. 값이 없으면 아카이브는
  // 펼침, 나머지는 접힘.
  const [brandPanelOpenByTab, setBrandPanelOpenByTab] = useState<
    Partial<Record<Tab, boolean>>
  >({});
  // 가독성 v2 §10.6 — nav 클릭 즉시 활성 표시. 무거운 탭 렌더는 transition
  // 으로 미루고, 그동안 nav 는 누른 탭을 먼저 활성으로 보여준다.
  const [navPending, startNavTransition] = useTransition();
  const [navTarget, setNavTarget] = useState<Tab | null>(null);
  // 광고 탭 "필터 더보기" 펼침 (v2 §10.4).
  const [adsMoreFiltersOpen, setAdsMoreFiltersOpen] = useState(false);
  // 헤더 "브랜드 검색" 버튼 → 아카이브로 이동한 뒤 검색창에 포커스.
  const focusSearchOnArchive = useRef(false);
  useEffect(() => {
    if (tab !== "archive" || !focusSearchOnArchive.current) return;
    focusSearchOnArchive.current = false;
    document.getElementById("brand-search-input")?.focus();
  }, [tab]);

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

  const refreshAll = async (options?: { skipAds?: boolean; freshAds?: boolean }) => {
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
    if (!options?.skipAds) {
      fetch(`/api/ads?withStats=false&limit=${INITIAL_ADS_LIMIT}`, {
        cache: options?.freshAds ? "no-store" : "default",
      })
        .then((r) => r.json())
        .then((d) => setAds(d.ads ?? []))
        .catch(() => {});
    }
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

  const resetAdFilters = () => {
    setSelectedAdIds(new Set());
    setAdTypeFilter("all");
    setFilter("all");
    setClassFilter("all");
    setSinceDateFilter(null);
    setInnerSearch("");
    setSelectedChannels(new Set());
    setViewBand("");
    setAgeBand("");
    setDisplayLimit(200);
    setDomainOnly(false);
  };

  const startAdCollection = (q: string, opts?: { snapshot?: boolean }) => {
    const keyword = normalizeAdKeyword(q);
    if (!keyword || isBusyKeyword(keyword)) return;

    resetAdFilters();
    setAdView("cards");

    // Initialize fresh state for this keyword
    setAdCollections((prev) => ({
      ...prev,
      [keyword]: {
        busy: true,
        logs: [],
        progress: { step: "starting", percent: 0 },
      },
    }));
    setSelectedKeyword(keyword);
    setTab("ads");

    // snapshot=1 → 서버가 Watch upsert skip = cron 미편입 (1회 조사만).
    const es = new EventSource(
      `/api/ads-stream?query=${encodeURIComponent(keyword)}${
        opts?.snapshot ? "&snapshot=1" : ""
      }`
    );
    adESRefs.current.set(keyword, es);

    es.addEventListener("job", () => {
      // Job row created in DB — refresh sidebar so 진행 중 entry appears
      void refreshAll({ skipAds: true });
    });

    es.addEventListener("log", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as {
          msg: string;
          level: LogLevel;
        };
        updateCollection(keyword, (c) => ({
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
        updateCollection(keyword, (c) => ({ ...c, progress: d }));
      } catch {}
    });

    const finish = () => {
      updateCollection(keyword, (c) => ({ ...c, busy: false }));
      adESRefs.current.delete(keyword);
      void refreshAll({ freshAds: true });
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
          updateCollection(keyword, (c) => ({
            ...c,
            logs: [
              ...c.logs,
              { time: new Date(), msg: `${d.message}`, level: "error" },
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
    if (!raw) return;
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
      const keyword = normalizeAdKeyword(kw);
      if (!isBusyKeyword(keyword))
        startAdCollection(keyword, { snapshot: snapshotMode });
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
      // 채널 chip — YouTube 매칭 광고는 ytChannel과 advertiserName을
      // 둘 다 가진다. 광고주 chip을 누른 뒤 YouTube 필터를 켰을 때도
      // 해당 광고주의 YouTube 소재가 보여야 하므로 둘 중 하나라도
      // 선택된 값과 맞으면 통과시킨다.
      if (selectedChannels.size > 0) {
        const channelMatches = [a.ytChannel, a.advertiserName]
          .filter(Boolean)
          .some((label) => selectedChannels.has(label as string));
        if (!channelMatches) return false;
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

  const visibleCardAds = sortedAds.slice(0, displayLimit);
  const visibleTableGroups = groupedAds.slice(0, displayLimit);
  const visibleTableAds = visibleTableGroups.flatMap((group) => group.siblings);
  const selectedFilteredAds = sortedAds.filter((ad) => selectedAdIds.has(ad.creativeId));
  const toggleAdIds = (ids: readonly string[], checked: boolean) => {
    setSelectedAdIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

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

  const tabMeta = TAB_META[tab];
  // "필터 더보기" 뒤로 접힌 광고 필터 중 지금 걸려 있는 개수.
  const adsMoreFilterCount =
    (filter !== "all" ? 1 : 0) +
    (hasDomainModeAds && domainOnly ? 1 : 0) +
    (viewBand ? 1 : 0) +
    (ageBand ? 1 : 0) +
    (innerSearch.trim() ? 1 : 0) +
    (adTypeFilter !== "all" ? 1 : 0) +
    (selectedChannels.size > 0 ? 1 : 0);
  const activeNavTab = navPending && navTarget ? navTarget : tab;

  // 브랜드 목록·수집 현황 — 가독성 v2(SUITE-DESIGN §10.3)에서 사이드바에서
  // 옮겨 온 블록. 상태·핸들러는 그대로이고 표시 위치만 본문으로 바뀌었다.
  // 브랜드 아카이브에서는 펼친 채, 구글/메타 광고 탭에서는 접힌 채 시작한다.
  const brandPanelOpen = brandPanelOpenByTab[tab] ?? tab === "archive";
  const brandPanel = (
    <details
      className="group panel brand-panel"
      open={brandPanelOpen}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        setBrandPanelOpenByTab((prev) =>
          prev[tab] === open ? prev : { ...prev, [tab]: open }
        );
      }}
    >
      <summary className="panel-header cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <h2>
          <Layers size={16} strokeWidth={1.75} aria-hidden />
          브랜드 목록 · 수집 현황
        </h2>
        <span className="inline-flex items-center gap-2 text-sm text-muted">
          <span className="tabular-nums">
            구글 {groupedJobs.length} · 메타 {metaBrandGroups.length}
          </span>
          <ChevronDown
            size={16}
            strokeWidth={1.75}
            aria-hidden
            className="transition-transform group-open:rotate-180"
          />
        </span>
      </summary>
      <div className="panel-body brand-panel-body">
        {/* 상단 요약 — 구글/메타 전환 · 수집 통계 · 자동수집 현황 */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            {/* Source switcher — 브랜드 목록을 구글 / 메타로 나눈다.
                Auto-syncs to the active main tab via the useEffect above;
                manual click here overrides until the next main-tab change. */}
            <div className="segmented" role="group" aria-label="브랜드 목록 출처">
              {(
                [
                  ["google", "구글", groupedJobs.length],
                  ["meta", "메타", metaBrandGroups.length],
                ] as const
              ).map(([key, label, n]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSidebarSource(key)}
                  aria-pressed={sidebarSource === key}
                  className="inline-flex items-center justify-center gap-1.5"
                >
                  {key === "google" ? (
                    <LayoutList size={14} strokeWidth={1.75} aria-hidden />
                  ) : (
                    <Megaphone size={14} strokeWidth={1.75} aria-hidden />
                  )}
                  {label} <span className="tabular-nums opacity-80">{n}</span>
                </button>
              ))}
            </div>

            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted">불러온 광고</span>
                <span className="font-semibold tabular-nums text-ink">
                  {ads.length.toLocaleString()}개
                </span>
              </div>
              {watches.filter((w) => w.active).length > 0 && (
                <div className="flex min-w-0 items-center gap-1.5 text-muted">
                  <Star size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-faint" />
                  <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-ink">
                    {watches.filter((w) => w.active).length}개 추적 중
                  </span>
                  <span aria-hidden>·</span>
                  <span className="truncate">매일 새벽 3시 자동 재수집</span>
                </div>
              )}
              {/* 첫 진입 안내 — keyword가 하나도 없을 때만 표시 (가벼움) */}
              {groupedJobs.length === 0 && metaBrandGroups.length === 0 && (
                <p className="text-muted">
                  검색을 누르면 여기로 바로 들어오고, 위에서부터 순서대로 자동
                  수집돼요.
                </p>
              )}
            </div>
          </div>

          {/* ===== 자동수집 현황 — 어제 새벽 3시 cron 결과 =====
              누락된 keyword는 펼침 가능 — 클릭 시 검색창에 그 keyword 를
              자동 채움 → 사용자가 불러오기 한 번 누르면 됨. */}
          {autoCollectStatus.total > 0 && (
            <div className="space-y-2 rounded-sm border border-line bg-surface-soft p-3">
              <div className="flex items-center justify-between gap-2 text-sm text-muted">
                <span>자동수집 · 지난 24시간</span>
                <span
                  className={
                    autoCollectStatus.successRate >= 100
                      ? "font-semibold tabular-nums text-success"
                      : "font-semibold tabular-nums text-ink"
                  }
                >
                  {autoCollectStatus.success}/{autoCollectStatus.total} (
                  {autoCollectStatus.successRate}%)
                </span>
              </div>
              {/* 진행바 — 성공률. 단색 */}
              <div className="progress">
                <div
                  className={
                    autoCollectStatus.successRate >= 100
                      ? "h-full rounded-full bg-success"
                      : "h-full rounded-full bg-accent"
                  }
                  style={{
                    width: `${Math.max(autoCollectStatus.successRate, 2)}%`,
                  }}
                />
              </div>
              {autoCollectStatus.missingCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowMissing((s) => !s)}
                  aria-expanded={showMissing}
                  className="btn btn-secondary btn-sm w-full justify-between font-medium"
                >
                  <span className="truncate">
                    미수집 {autoCollectStatus.missingCount}개
                    {autoCollectStatus.failedCount > 0 && (
                      <span className="ml-1 font-normal text-faint">
                        (실패 {autoCollectStatus.failedCount} · 미실행{" "}
                        {autoCollectStatus.notRunCount})
                      </span>
                    )}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-muted">
                    {showMissing ? (
                      <ChevronUp size={14} strokeWidth={1.75} aria-hidden />
                    ) : (
                      <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
                    )}
                    {showMissing ? "닫기" : "즉시복구"}
                  </span>
                </button>
              ) : (
                <div className="text-sm font-medium text-success">
                  정상 · 누락 없음
                </div>
              )}
              {showMissing && autoCollectStatus.missing.length > 0 && (
                <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                  {autoCollectStatus.missing.map((m) => (
                    <li key={`${m.source}::${m.keyword}`}>
                      <button
                        type="button"
                        onClick={() => {
                          if (m.source === "meta") {
                            setTab("meta");
                            setSelectedKeyword(m.keyword);
                          } else {
                            // 검색창은 브랜드 아카이브에만 있다 (v2) — 그 화면에 채운다.
                            setAdQuery(m.keyword);
                            setTab("archive");
                            setSelectedKeyword(m.keyword);
                          }
                        }}
                        title={`${m.reason} · 클릭하면 검색창에 채움`}
                        className="flex min-h-9 w-full items-center justify-between gap-2 rounded-sm px-2 text-sm text-muted transition-colors hover:bg-surface hover:text-ink"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          {m.source === "meta" ? (
                            <Megaphone size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
                          ) : (
                            <LayoutList size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
                          )}
                          <span className="truncate">{m.keyword}</span>
                        </span>
                        <span
                          className={
                            m.reason === "실패"
                              ? "shrink-0 text-xs text-danger"
                              : "shrink-0 text-xs text-faint"
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
        </div>

        {/* ===== 그룹 (tier) · 태그 필터 — 아래 브랜드 목록에만 적용 ===== */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line pt-4">
          <div role="group" aria-label="그룹 필터" className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
              <Layers size={14} strokeWidth={1.75} aria-hidden className="text-faint" />
              그룹
            </span>
            <button
              type="button"
              onClick={() => setTierFilter(null)}
              aria-pressed={tierFilter === null}
              className="chip"
            >
              전체
            </button>
            {(["A1", "A2", "A3"] as const).map((t) => {
              const m = TIER_META[t];
              const active = tierFilter === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTierFilter(active ? null : t)}
                  aria-pressed={active}
                  className="chip"
                >
                  <span aria-hidden className={`chip-dot ${m.dot}`} />
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* 태그 필터 chip group — 클릭 → 그 태그 가진 keyword만 목록에
              보임 (메타 / 구글 두 모드 모두 적용). allTags.length === 0 이면 hidden. */}
          {allTags.length > 0 && (
            <div role="group" aria-label="태그 필터" className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
                <Tag size={14} strokeWidth={1.75} aria-hidden className="text-faint" />
                태그
              </span>
              {allTags.map((t) => {
                const active = selectedTag === t;
                const c = tagColor(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSelectedTag(active ? null : t)}
                    aria-pressed={active}
                    className="chip"
                  >
                    <span aria-hidden className={`chip-dot ${c.dot}`} />#{t}
                  </button>
                );
              })}
              {selectedTag && (
                <button
                  type="button"
                  onClick={() => setSelectedTag(null)}
                  className="btn btn-ghost btn-sm"
                >
                  <X size={14} strokeWidth={1.75} aria-hidden />
                  해제
                </button>
              )}
            </div>
          )}
        </div>

        <div className={sidebarSource === "google" ? "" : "hidden"}>
          {!loaded ? (
            <div className="py-6 text-center text-sm text-muted">
              불러오는 중...
            </div>
          ) : groupedJobs.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted">
              기록이 없습니다
            </div>
          ) : (
            <ul className="brand-list">
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
                      className={`group/job relative rounded-sm transition-colors ${
                        active
                          ? "bg-accent-soft"
                          : "hover:bg-surface-soft"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedKeyword(active ? null : g.keyword);
                          if (!active) {
                            // Only switch tab if currently on an
                            // incompatible one. Stay on 소재 분석 if user
                            // is exploring there. 브랜드 아카이브(v2 에서 이
                            // 목록이 놓인 곳)에서 누르면 광고 표로 넘어간다.
                            if (g.kind !== "ad" || tab === "archive") {
                              setTab("ads");
                            }
                          }
                        }}
                        aria-pressed={active}
                        className="w-full rounded-sm px-2.5 py-2 pr-2 text-left text-sm transition-all group-hover/job:pr-[7.5rem] group-focus-within/job:pr-[7.5rem]"
                      >
                        <div className="flex items-center gap-2">
                          {/* 아바타 — 아카이브 카드와 같은 색 규칙이라
                              목록 ↔ 카드가 같은 브랜드로 인식된다. */}
                          <span className="relative shrink-0">
                            <span
                              aria-hidden
                              className="grid h-7 w-7 place-items-center rounded-sm text-xs font-semibold text-white"
                              style={{
                                background: `hsl(${brandHue(g.keyword)} 62% 55%)`,
                              }}
                            >
                              {brandInitial(g.keyword)}
                            </span>
                            {isRunning && (
                              <span className="absolute -right-0.5 -top-0.5 inline-block h-2 w-2 animate-pulse rounded-full bg-accent ring-2 ring-surface" />
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
                                className={`absolute -bottom-0.5 -right-0.5 inline-block h-3 w-3 cursor-pointer rounded-full ring-2 ring-surface transition hover:scale-125 ${
                                  wInfo?.tier && TIER_META[wInfo.tier]
                                    ? TIER_META[wInfo.tier].dot
                                    : "border border-line-strong bg-surface"
                                }`}
                              />
                            )}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">
                            {g.keyword}
                          </span>
                          {watched && (
                            <span
                              title="매일 자동으로 다시 불러옵니다"
                              className="shrink-0 text-muted"
                            >
                              <Star size={14} strokeWidth={1.75} fill="currentColor" aria-hidden />
                              <span className="sr-only">자동 추적 중</span>
                            </span>
                          )}
                          <span
                            title={isRunning ? undefined : g.status}
                            className={`shrink-0 transition group-hover/job:opacity-0 ${
                              isRunning || g.status === "진행 중"
                                ? "badge badge-accent tabular-nums"
                                : g.status === "대기 중"
                                ? "badge badge-neutral"
                                : g.status === "완료"
                                ? "badge badge-success"
                                : g.status === "실패"
                                ? "badge badge-danger"
                                : "badge badge-warning"
                            }`}
                          >
                            {isRunning ? (
                              `${inFlight!.progress.percent}%`
                            ) : g.status === "완료" ? (
                              <>
                                <CircleCheck size={12} strokeWidth={2} aria-hidden />
                                <span className="sr-only">완료</span>
                              </>
                            ) : g.status === "실패" ? (
                              <>
                                <CircleX size={12} strokeWidth={2} aria-hidden />
                                <span className="sr-only">실패</span>
                              </>
                            ) : (
                              g.status
                            )}
                          </span>
                        </div>
                        {isRunning && (
                          <div className="progress mt-1.5">
                            <div
                              className="h-full rounded-full bg-accent transition-all duration-300"
                              style={{
                                width: `${inFlight!.progress.percent}%`,
                              }}
                            />
                          </div>
                        )}
                        {isRunning && lastLog && (
                          <div className="mt-1 truncate text-sm text-accent">
                            {lastLog.msg}
                          </div>
                        )}
                        {/* 2줄: 상대시간 · 광고/매칭 — 절대 줄바꿈 없이 한 줄. */}
                        <div className="mt-0.5 flex items-center gap-1 overflow-hidden whitespace-nowrap pl-9 text-sm text-faint">
                          <span className="shrink-0" title={formatTime(g.latestAt)}>
                            {formatRelative(g.latestAt)}
                          </span>
                          <span aria-hidden className="shrink-0">·</span>
                          <span className="shrink-0 text-muted">
                            {g.kind === "ad" ? (
                              <>
                                광고 <b className="font-semibold tabular-nums text-ink">{g.adCount}</b>
                                {g.videoCount > 0 && (
                                  <> · 매칭 <b className="font-semibold tabular-nums text-ink">{g.videoCount}</b></>
                                )}
                              </>
                            ) : (
                              <>
                                영상 <b className="font-semibold tabular-nums text-ink">{g.videoCount}</b>
                              </>
                            )}
                          </span>
                        </div>
                        {g.status === "실패" && g.errorMsg && (
                          <div
                            className="mt-1 truncate pl-9 text-sm text-danger"
                            title={g.errorMsg}
                          >
                            {humanizeErrorMsg(g.errorMsg)}
                          </div>
                        )}
                      </button>
                      {/* ===== 태그 영역 (행 아래 — button 밖) =====
                          기존 태그 chip 표시 + "태그" 추가 input. button
                          중첩 방지를 위해 메인 button 밖에 위치. */}
                      <div className="px-2.5 pb-1.5 pl-[46px]">
                        <div className="flex flex-wrap items-center gap-1">
                          {(tagMap[g.keyword] ?? []).map((t) => {
                            const c = tagColor(t);
                            return (
                              <span key={t} className="chip h-6 gap-1 px-2">
                                <span aria-hidden className={`chip-dot ${c.dot}`} />#{t}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeTag(g.keyword, t);
                                  }}
                                  className="rounded-xs text-faint transition-colors hover:text-danger"
                                  title="태그 제거"
                                  aria-label={`태그 ${t} 제거`}
                                >
                                  <X size={12} strokeWidth={2} aria-hidden />
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
                              className="field-input min-h-7 w-28 px-2 py-0.5 text-sm"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingTagFor(g.keyword);
                                setTagInput("");
                              }}
                              className="inline-flex h-6 items-center gap-1 rounded-xs px-1.5 text-sm text-faint transition-colors hover:bg-surface-soft hover:text-ink"
                            >
                              <Plus size={12} strokeWidth={2} aria-hidden />
                              태그
                            </button>
                          )}
                        </div>
                      </div>
                      {/* hover 액션 버튼 — flex 컨테이너로 묶어 gap 정렬.
                          평소 숨김, hover 시 우측에 가로로 표시. */}
                      <div className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition group-focus-within/job:opacity-100 group-hover/job:opacity-100">
                        <button
                          type="button"
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
                          aria-label="지금 재수집"
                          className="icon-btn-28 text-muted hover:bg-surface-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <RefreshCw size={14} strokeWidth={1.75} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await toggleWatch(g.keyword, g.kind);
                          }}
                          title={watched ? "자동 추적 해제" : "자동 추적 켜기"}
                          aria-label={watched ? "자동 추적 해제" : "자동 추적 켜기"}
                          aria-pressed={watched}
                          className={`icon-btn-28 hover:bg-surface-soft ${
                            watched
                              ? "text-ink"
                              : "text-muted hover:text-ink"
                          }`}
                        >
                          <Star
                            size={14}
                            strokeWidth={1.75}
                            fill={watched ? "currentColor" : "none"}
                            aria-hidden
                          />
                        </button>
                        {watched && (
                          <button
                            type="button"
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
                            className={`h-7 rounded-sm px-1.5 text-sm font-semibold transition-colors hover:bg-surface-soft ${
                              wInfo?.daily
                                ? "text-ink"
                                : "text-muted hover:text-ink"
                            }`}
                          >
                            {wInfo?.daily ? "매일" : "격일"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (
                              !(await confirmDialog(
                                `"${g.keyword}" ${
                                  g.kind === "ad" ? "광고 수집" : "YouTube 검색"
                                } 결과를 삭제할까요?${
                                  watched ? "\n자동 추적도 함께 해제됩니다." : ""
                                }`
                              ))
                            )
                              return;
                            // 추적이 남아 있으면 다음 자동 수집 때 목록에 다시 생기므로 함께 해제한다.
                            if (watched) {
                              await fetch("/api/watch", {
                                method: "DELETE",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ keyword: g.keyword, kind: g.kind }),
                              });
                            }
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
                          aria-label="이 작업 삭제"
                          className="icon-btn-28 text-muted hover:bg-surface-soft hover:text-danger"
                        >
                          <X size={14} strokeWidth={1.75} aria-hidden />
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
          <div>
            <div className="flex items-center justify-between gap-2 pb-2 text-sm font-medium text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Megaphone size={14} strokeWidth={1.75} aria-hidden className="text-faint" />
                메타 광고 브랜드
              </span>
              <span className="text-xs tabular-nums">{metaBrandGroups.length}개</span>
            </div>
            {metaBrandGroups.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted">
                메타 광고 탭 → 새 brand 입력으로 시작
              </div>
            ) : (
            <ul className="brand-list">
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
                // promoted to anchor). Show a star to signal that, matching
                // the Google row's tracked-state visual.
                const watched = metaWatches.some(
                  (w) =>
                    w.active && (w.keyword === g.anchor || w.anchorKeyword === g.anchor)
                );
                return (
                  <li key={`meta::${g.anchor}`}>
                    <div
                      className={`group/meta relative rounded-sm transition-colors ${
                        active
                          ? "bg-accent-soft"
                          : "hover:bg-surface-soft"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setTab("meta");
                          setSelectedKeyword(g.anchor);
                        }}
                        aria-pressed={active}
                        className="w-full rounded-sm px-2.5 py-2 pr-2 text-left text-sm transition-all group-hover/meta:pr-16 group-focus-within/meta:pr-16"
                      >
                        <div className="flex min-h-6 items-center gap-2">
                          <span
                            aria-hidden
                            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                              isRunning
                                ? "animate-pulse bg-accent"
                                : hasError
                                ? "bg-danger"
                                : g.adCount > 0 || g.pageCount > 0
                                ? "bg-success"
                                : "bg-line-strong"
                            }`}
                          />
                          <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">
                            {g.anchor}
                          </span>
                          {watched && (
                            <Star size={12} strokeWidth={2} fill="currentColor" aria-hidden className="shrink-0 text-muted" />
                          )}
                          <span
                            className={`shrink-0 transition group-hover/meta:opacity-0 ${
                              isRunning
                                ? "badge badge-accent"
                                : hasError
                                ? "badge badge-danger"
                                : g.adCount > 0 || g.pageCount > 0
                                ? "badge badge-success"
                                : "badge badge-neutral"
                            }`}
                          >
                            {isRunning ? (
                              <>
                                <LoaderCircle size={12} strokeWidth={2} aria-hidden className="animate-spin" />
                                <span className="sr-only">수집 중</span>
                              </>
                            ) : hasError ? (
                              <>
                                <CircleX size={12} strokeWidth={2} aria-hidden />
                                <span className="sr-only">실패</span>
                              </>
                            ) : g.adCount > 0 || g.pageCount > 0 ? (
                              <>
                                <CircleCheck size={12} strokeWidth={2} aria-hidden />
                                <span className="sr-only">완료</span>
                              </>
                            ) : (
                              "대기"
                            )}
                          </span>
                        </div>
                        {/* 2줄: 상대시간 · 광고 N · 페이지 N — 절대 줄바꿈 없이 한 줄. */}
                        <div className="mt-0.5 flex items-center gap-1 overflow-hidden whitespace-nowrap pl-4 text-sm text-faint">
                          <span className="shrink-0" title={g.latestAt ? formatTime(g.latestAt) : ""}>
                            {g.latestAt ? formatRelative(g.latestAt) : "수집 전"}
                          </span>
                          <span aria-hidden className="shrink-0">·</span>
                          <span className="shrink-0 text-muted">
                            광고 <b className="font-semibold tabular-nums text-ink">{g.adCount}</b>
                            {g.pageWatches > 0 && (
                              <> · 페이지 <b className="font-semibold tabular-nums text-ink">{g.pageWatches}</b></>
                            )}
                          </span>
                          {g.autoCount > 0 && (
                            <span
                              title={`자동 발굴 ${g.autoCount}${g.manualCount > 0 ? ` · 수동 ${g.manualCount}` : ""}${g.seedCount > 0 ? ` · seed ${g.seedCount}` : ""}`}
                              className="ml-auto shrink-0 text-success"
                            >
                              auto {g.autoCount}
                            </span>
                          )}
                        </div>
                      </button>
                      {/* ===== 태그 영역 (행 아래 — button 밖) ===== */}
                      <div className="px-2.5 pb-1.5 pl-[26px]">
                        <div className="flex flex-wrap items-center gap-1">
                          {(tagMap[g.anchor] ?? []).map((t) => {
                            const c = tagColor(t);
                            return (
                              <span key={t} className="chip h-6 gap-1 px-2">
                                <span aria-hidden className={`chip-dot ${c.dot}`} />#{t}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeTag(g.anchor, t);
                                  }}
                                  className="rounded-xs text-faint transition-colors hover:text-danger"
                                  title="태그 제거"
                                  aria-label={`태그 ${t} 제거`}
                                >
                                  <X size={12} strokeWidth={2} aria-hidden />
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
                              className="field-input min-h-7 w-28 px-2 py-0.5 text-sm"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingTagFor(g.anchor);
                                setTagInput("");
                              }}
                              className="inline-flex h-6 items-center gap-1 rounded-xs px-1.5 text-sm text-faint transition-colors hover:bg-surface-soft hover:text-ink"
                            >
                              <Plus size={12} strokeWidth={2} aria-hidden />
                              태그
                            </button>
                          )}
                        </div>
                      </div>
                      {/* 지금 재수집 — 구글 행의 재수집과 동일. anchor keyword 를
                          메타 큐에 다시 넣어 stage 1 + 1.5 를 재실행한다. 실패로
                          끝난 brand 도 새 코드 + 살아있는 프록시로 재시도 가능. */}
                      {/* hover 액션 버튼 — flex 컨테이너로 묶어 gap 정렬. */}
                      <div className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition group-focus-within/meta:opacity-100 group-hover/meta:opacity-100">
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (isRunning) return;
                            // 트래픽 안내 — 메타 1회 수집 ~200MB. 프록시 경유 시 그만큼 차감.
                            // 사용자가 의식하고 누르도록 confirm. 자주 누르면
                            // 트래픽 빠르게 소진.
                            if (
                              !(await confirmDialog(
                                `"${g.anchor}" 메타 광고 재수집\n\n` +
                                  `예상 트래픽: 약 200MB\n` +
                                  `프록시를 쓰신다면 그만큼 차감됩니다.\n\n` +
                                  `진행할까요?`
                              ))
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
                          aria-label="지금 메타 다시 불러오기 (약 200MB)"
                          className="icon-btn-28 text-muted hover:bg-surface-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <RefreshCw size={14} strokeWidth={1.75} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (
                              !(await confirmDialog(
                                `"${g.anchor}" 메타 브랜드 추적을 해제할까요? (관련 키워드 ${g.keywords.length}개 모두 해제)`
                              ))
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
                          aria-label="이 브랜드 추적 해제"
                          className="icon-btn-28 text-muted hover:bg-surface-soft hover:text-danger"
                        >
                          <X size={14} strokeWidth={1.75} aria-hidden />
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

        {/* 전체 데이터 삭제 — v2 에서 사이드바 푸터에서 옮겨 왔다. */}
        {(jobs.length > 0 || ads.length > 0 || deleteDone) && (
          <div className="space-y-3 border-t border-line pt-4">
            {(jobs.length > 0 || ads.length > 0) && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted">
                  수집한 광고·작업 기록을 모두 지웁니다.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteOpen((open) => !open);
                    setDeleteError(null);
                    setDeleteDone(false);
                  }}
                  aria-expanded={deleteOpen}
                  className="btn btn-danger btn-sm"
                >
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                  전체 데이터 삭제
                </button>
              </div>
            )}
            {deleteOpen && (jobs.length > 0 || ads.length > 0) && (
              <form
                className="ml-auto max-w-md space-y-2 rounded-sm border border-danger-line bg-danger-soft p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void clearAll();
                }}
              >
                <p className="text-sm text-danger">
                  되돌릴 수 없습니다. 관리자 비밀번호를 입력하세요.
                </p>
                <input
                  type="password"
                  value={deleteSecret}
                  onChange={(event) => setDeleteSecret(event.target.value)}
                  placeholder="관리자 비밀번호"
                  autoComplete="off"
                  aria-label="관리자 비밀번호"
                  className="field-input w-full"
                />
                {deleteError && <p role="alert" className="text-sm text-danger">{deleteError}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteOpen(false);
                      setDeleteSecret("");
                      setDeleteError(null);
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={!deleteSecret.trim() || deletingAll}
                    aria-busy={deletingAll}
                    className="btn btn-sm bg-danger text-white"
                  >
                    {deletingAll ? "삭제 중…" : "삭제 실행"}
                  </button>
                </div>
              </form>
            )}
            {deleteDone && (
              <p role="status" className="flex items-center gap-1.5 text-sm text-success">
                <CircleCheck size={14} strokeWidth={1.75} aria-hidden />
                전체 데이터가 삭제되었습니다.
              </p>
            )}
          </div>
        )}
      </div>
    </details>
  );

  return (
    <div className="app-shell bg-[var(--bg-base)] text-[var(--text-primary)]">
      <a href="#main-content" className="skip-link">
        본문으로 건너뛰기
      </a>
      {/* 태그 input 자동완성 — 기존에 라벨링된 태그들 suggest */}
      <datalist id="known-tags">
        {allTags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {/* Sidebar — 스위트 공통 차콜 사이드바 (globals.css .sidebar) */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span aria-hidden className="sidebar-brand-mark">
            AD
          </span>
          <div className="min-w-0">
            <div className="sidebar-brand-name">AD 스위트</div>
          </div>
          <span className="status-chip status-chip-sidebar" role="status">
            <span
              aria-hidden
              className={`status-dot ${anyBusyAds ? "text-accent-on-dark" : "text-sidebar-success"}`}
            />
            {anyBusyAds ? "수집 중" : "대기 중"}
          </span>
        </div>

        <div className="switcher">
          <label htmlFor="app-switcher" className="sr-only">
            앱 선택
          </label>
          <details className="group relative">
            <summary
              id="app-switcher"
              className="switcher-trigger"
              aria-label="앱 선택"
            >
              <span className="app-avatar app-avatar-lg app-avatar-successai">S</span>
              <span className="min-w-0 flex-1">
                <strong className="switcher-name">Success AI 광고수집기</strong>
                <small className="switcher-sub">구글·메타 광고 레퍼런스 수집</small>
              </span>
              <ChevronsUpDown size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-sidebar-faint" />
            </summary>
            <div className="switcher-menu">
              <p className="switcher-menu-title">AD 스위트</p>
              <a className="switcher-item" href="http://127.0.0.1:3000/">
                <span className="app-avatar app-avatar-sm app-avatar-trendwatch">K</span>
                <span className="min-w-0 flex-1">
                  <strong className="switcher-name">키워드워처</strong>
                  <small className="switcher-sub">검색량·시장 트렌드 추적</small>
                </span>
              </a>
              <a className="switcher-item" href="/" aria-current="page">
                <span className="app-avatar app-avatar-sm app-avatar-successai">S</span>
                <span className="min-w-0 flex-1">
                  <strong className="switcher-name">Success AI 광고수집기</strong>
                  <small className="switcher-sub">구글·메타 광고 레퍼런스 수집</small>
                </span>
                <Check size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-accent-on-dark" />
              </a>
              <a className="switcher-item" href="http://127.0.0.1:4317/">
                <span className="app-avatar app-avatar-sm app-avatar-adfactory">A</span>
                <span className="min-w-0 flex-1">
                  <strong className="switcher-name">AD FACTORY</strong>
                  <small className="switcher-sub">광고 설계·제작·배포 자동화</small>
                </span>
              </a>
            </div>
          </details>
        </div>

        <nav className="sidebar-nav" aria-label="Success AI 메뉴">
          {(
            [
              ["archive", archiveBrands.length],
              ["ads", scopedAds.length],
              ["meta", null],
              ["creatives", creativePool.length],
              ["dashboard", null],
              ["guide", null],
            ] as const
          ).map(([key, count]) => {
            const { label, Icon } = TAB_META[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setNavTarget(key);
                  startNavTransition(() => setTab(key));
                }}
                aria-current={activeNavTab === key ? "page" : undefined}
                className="nav-item"
              >
                <Icon size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {count !== null && count > 0 && (
                  <span className="nav-count">{count.toLocaleString()}</span>
                )}
              </button>
            );
          })}
        </nav>


        <div className="sidebar-footer">
          <p className="local-note">
            <span aria-hidden className="status-dot text-sidebar-success" />
            로컬
          </p>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <nav aria-label="현재 위치" className="breadcrumb">
            <span>Success AI</span>
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
            <strong aria-current="page">{tabMeta.label}</strong>
          </nav>
          <div className="flex items-center gap-2">
            {/* 큰 검색 패널은 브랜드 아카이브에만 둔다 (v2 §10.4).
                다른 화면에서는 이 버튼으로 아카이브 검색창으로 이동. */}
            {tab !== "archive" && (
              <button
                type="button"
                onClick={() => {
                  focusSearchOnArchive.current = true;
                  setNavTarget("archive");
                  startNavTransition(() => setTab("archive"));
                }}
                className="btn btn-ghost btn-sm"
              >
                <Search size={16} strokeWidth={1.75} aria-hidden />
                브랜드 검색
              </button>
            )}
            <span className="status-chip" role="status">
              <span
                aria-hidden
                className={`status-dot ${anyBusyAds ? "text-accent" : "text-success"}`}
              />
              {anyBusyAds ? "수집 중" : "대기 중"}
            </span>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="workspace-body space-y-5 outline-none">
          <div className="page-heading">
            <div>
              <p className="eyebrow">{tabMeta.eyebrow}</p>
              <h1>{tabMeta.label}</h1>
              <p>{tabMeta.description}</p>
            </div>
          </div>

          {/* 검색 툴바 — 이 도구에서 사용자가 제일 먼저 하는 행동이
              "브랜드 하나 넣고 불러오기" 라서 페이지 제목 바로 아래 둔다.
              v2(§10.4): 큰 검색 패널은 브랜드 아카이브에만. */}
          {tab === "archive" && (
            <section className="panel p-4" aria-label="브랜드 검색">
              <AdSearchBox
                inputId="brand-search-input"
                query={adQuery}
                onQueryChange={setAdQuery}
                onSearch={runAdSearch}
                disabled={!adQuery.trim() || isBusyKeyword(adQuery.trim())}
                buttonLabel={isBusyKeyword(adQuery.trim())
                  ? "불러오는 중"
                  : anyBusyAds
                  ? "추가 수집"
                  : "불러오기"}
              />

              {/* 예시 칩 — 빈 화면에서 뭘 넣어야 할지 알려주는 역할. */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
                <span className="text-muted">예시</span>
                {["올리브영", "무신사", "oliveyoung.co.kr"].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setAdQuery(d)}
                    className="chip"
                  >
                    {d}
                  </button>
                ))}
                <label className="ml-2 flex min-h-7 cursor-pointer items-center gap-1.5 text-muted">
                  <input
                    type="checkbox"
                    checked={snapshotMode}
                    onChange={(e) => setSnapshotMode(e.target.checked)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <Camera size={14} strokeWidth={1.75} aria-hidden />
                  1회만 (자동 갱신 안 함)
                </label>
              </div>
            </section>
          )}

          {(tab === "archive" || tab === "ads" || tab === "meta") && brandPanel}

          {selectedKeyword && (tab === "ads" || tab === "meta") && (
            <div className="notice notice-accent items-center justify-between" role="status">
              <div className="flex min-w-0 items-center gap-2">
                <Search size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
                <span>
                  검색어 <b className="font-semibold">"{selectedKeyword}"</b>의 결과만 보고 있어요
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedKeyword(null)}
                className="btn btn-ghost btn-sm shrink-0 text-accent-ink"
              >
                <X size={14} strokeWidth={1.75} aria-hidden />
                전체 보기
              </button>
            </div>
          )}

          {/* ===== 광고주 순위 패널 ===== 레퍼런스 대시보드의 "내가 추적
              중인 N개 업체 중 이 광고주 위치" 위젯. 레퍼런스/소재 탭에서
              selectedKeyword 있을 때만. */}
          {selectedKeyword &&
            (tab === "ads" || tab === "creatives") &&
            !(tab === "ads" && adView === "cards") &&
            advertiserRanking &&
            advertiserRanking.total >= 2 && (
              <section className="panel">
                <div className="panel-header">
                  <h2>
                    <Trophy size={16} strokeWidth={1.75} aria-hidden />
                    내가 추적 중인 {advertiserRanking.total}개 업체 중 이
                    광고주 위치
                  </h2>
                </div>
                <div className="panel-body">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* 소재수 순위 */}
                  <div>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
                        <Clapperboard size={14} strokeWidth={1.75} aria-hidden className="text-faint" />
                        광고 소재수
                      </span>
                      <span className="text-sm tabular-nums text-faint">
                        {advertiserRanking.adCount}개
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-page font-semibold leading-tight tabular-nums tracking-[-0.03em] text-ink">
                        {advertiserRanking.adRank}위
                      </span>
                      <span className="text-sm tabular-nums text-faint">
                        / {advertiserRanking.total}
                      </span>
                      <span
                        className={`ml-auto ${
                          advertiserRanking.adRankPercent >= 80
                            ? "badge badge-warning"
                            : advertiserRanking.adRankPercent >= 50
                            ? "badge badge-success"
                            : "badge badge-neutral"
                        }`}
                      >
                        {advertiserRanking.adRankPercent >= 80 ? (
                          <Flame size={12} strokeWidth={2} aria-hidden />
                        ) : advertiserRanking.adRankPercent >= 50 ? (
                          <TrendingUp size={12} strokeWidth={2} aria-hidden />
                        ) : null}
                        {advertiserRanking.adRankPercent >= 80
                          ? "상위"
                          : advertiserRanking.adRankPercent >= 50
                          ? "중상위"
                          : "중하위"}{" "}
                        {100 - advertiserRanking.adRankPercent + 1}%
                      </span>
                    </div>
                    <div className="progress mt-2">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{
                          width: `${advertiserRanking.adRankPercent}%`,
                        }}
                      />
                    </div>
                  </div>
                  {/* 가속도 순위 (analyzeDays 기준) */}
                  <div>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
                        <Rocket size={14} strokeWidth={1.75} aria-hidden className="text-faint" />
                        가속도 (
                        {analyzeDays === "all"
                          ? "전체"
                          : `최근 ${analyzeDays}일`}
                        )
                      </span>
                      <span className="text-sm tabular-nums text-faint">
                        {advertiserRanking.avgAccel >= 0 ? "+" : ""}
                        {advertiserRanking.avgAccel.toLocaleString()}/일
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-page font-semibold leading-tight tabular-nums tracking-[-0.03em] text-ink">
                        {advertiserRanking.accelRank}위
                      </span>
                      <span className="text-sm tabular-nums text-faint">
                        / {advertiserRanking.total}
                      </span>
                      <span
                        className={`ml-auto ${
                          advertiserRanking.accelRankPercent >= 80
                            ? "badge badge-danger"
                            : advertiserRanking.accelRankPercent >= 50
                            ? "badge badge-success"
                            : "badge badge-neutral"
                        }`}
                      >
                        {advertiserRanking.accelRankPercent >= 80 ? (
                          <Flame size={12} strokeWidth={2} aria-hidden />
                        ) : advertiserRanking.accelRankPercent >= 50 ? (
                          <TrendingUp size={12} strokeWidth={2} aria-hidden />
                        ) : null}
                        {advertiserRanking.accelRankPercent >= 80
                          ? "상위"
                          : advertiserRanking.accelRankPercent >= 50
                          ? "중상위"
                          : "중하위"}{" "}
                        {100 - advertiserRanking.accelRankPercent + 1}%
                      </span>
                    </div>
                    <div className="progress mt-2">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{
                          width: `${advertiserRanking.accelRankPercent}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-sm text-faint">
                  기준: 분석 기간(
                  {analyzeDays === "all" ? "전체" : `${analyzeDays}일`}) 내
                  본인이 추적 중인 업체들 사이에서의 순위
                </div>
                </div>
              </section>
            )}

          {/* ===== 스냅샷 타임라인 ===== 그 keyword 광고들의 AdStat
              capturedDate union. 가로 chip 한 줄. 클릭 → 그 날 이후 등장한
              광고만 필터링. 레퍼런스 대시보드의 시간 칩 UX와 동일. */}
          {selectedKeyword &&
            tab === "ads" &&
            adView === "table" &&
            snapshotTimeline &&
            snapshotTimeline.dates.length > 0 && (
              <section className="panel">
                <div className="panel-header">
                  <h2>
                    <Calendar size={16} strokeWidth={1.75} aria-hidden />
                    스냅샷 {snapshotTimeline.dates.length}개
                  </h2>
                  <span className="text-sm tabular-nums text-muted">
                    최초: {snapshotTimeline.first} · 최신:{" "}
                    {snapshotTimeline.last}
                  </span>
                </div>
                <div className="panel-body">
                <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
                  <button
                    onClick={() => setSinceDateFilter(null)}
                    aria-pressed={sinceDateFilter === null}
                    className="chip shrink-0 tabular-nums"
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
                        aria-pressed={active}
                        className="chip shrink-0 tabular-nums"
                      >
                        {i + 1}.{" "}
                        {d.replace(/^\d{4}-/, "").replace("-", "/")}
                        {n > 0 && (
                          <span className="text-success">
                            +{n}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {sinceDateFilter && (
                  <div className="mt-2 flex items-center gap-1.5 text-sm text-accent-ink">
                    <Search size={14} strokeWidth={1.75} aria-hidden />
                    <span>
                      {sinceDateFilter} 이후 ATC에 처음 등장한 광고만 보고
                      있어요 — 같은 카드의{" "}
                      <X size={12} strokeWidth={2} aria-label="닫기" className="inline align-[-1px]" />{" "}
                      클릭으로 해제
                    </span>
                  </div>
                )}
                </div>
              </section>
            )}

          {tab === "guide" ? (
            <GuideView onGoTo={(t) => setTab(t)} />
          ) : tab === "archive" ? (
            <BrandArchive
              brands={archiveBrands}
              onOpen={(kw) => {
                resetAdFilters();
                setAdView("cards");
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
                  <div className="mt-2 text-sm">
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
          ) : tab === "ads" && selectedKeyword && adView === "cards" ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="segmented flex-wrap">
                  {(["all", "image", "video", "other", "youtube"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setAdTypeFilter(type)}
                      aria-pressed={adTypeFilter === type}
                    >
                      {type === "all" ? "전체" : type === "image" ? "이미지" : type === "video" ? "영상" : type === "other" ? "기타" : "YouTube"}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => setAdView("table")} className="btn btn-secondary btn-sm">
                  분석 표 보기
                </button>
              </div>
              {currentCollection?.busy && (
                <div className="notice notice-accent items-center" role="status">
                  <LoaderCircle size={16} strokeWidth={1.75} aria-hidden className="animate-spin" />
                  광고 수집 중 · {currentCollection.progress.percent}%
                </div>
              )}
              <AdCardGrid
                key={selectedKeyword}
                ads={visibleCardAds}
                keyword={selectedKeyword}
                totalCount={sortedAds.length}
                collectedCount={scopedAds.length}
                onClearFilters={resetAdFilters}
                selectedIds={selectedAdIds}
                onToggle={(id, checked) => toggleAdIds([id], checked)}
                selectionActions={<AdSelectionToolbar
                  selectedAds={selectedFilteredAds}
                  visibleCount={visibleCardAds.length}
                  onSelectAll={() => toggleAdIds(visibleCardAds.map((ad) => ad.creativeId), true)}
                  onClear={() => setSelectedAdIds(new Set())}
                />}
              />
              {sortedAds.length > displayLimit && (
                <button type="button" onClick={() => setDisplayLimit((limit) => limit + 200)} className="btn btn-secondary w-full border-dashed">
                  광고 {displayLimit.toLocaleString()}/{sortedAds.length.toLocaleString()}개 표시 중 · 200개 더 보기
                </button>
              )}
            </>
          ) : tab === "ads" ? (
            <>
              {/* 데이터 출처 안내 — 표의 조회수를 광고 노출수로 오해하는
                  일이 실제로 잦다. 구글은 노출/비용을 공개하지 않고, 이
                  숫자는 광고 소재로 쓰인 YouTube 영상의 공개 통계다. */}
              <div className="notice notice-info" role="note">
                <Info size={16} strokeWidth={1.75} aria-hidden />
                <div className="min-w-0 flex-1 text-base text-muted">
                  <b className="font-semibold text-ink">
                    구글 광고 투명성 센터
                  </b>
                  에서 가져온 광고입니다. 구글은 노출수·비용을 공개하지 않아서,
                  영상 광고는 소재로 쓰인{" "}
                  <b className="font-semibold text-ink">YouTube 영상의 공개 통계</b>
                  (조회수·좋아요·게시일)를 붙여 성과를 가늠합니다.
                  <div className="mt-1 text-sm text-faint">
                    조회수는 광고 노출수가 아니라 유기적 조회까지 합쳐진
                    숫자입니다. 절대값보다 <b>브랜드 안에서의 상대 순위</b>로
                    보세요. 이미지 광고는 숫자가 비어 있는 게 정상입니다.
                  </div>
                </div>
                <button
                  onClick={() => setTab("guide")}
                  className="btn btn-secondary btn-sm shrink-0"
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
                  className="text-base text-[var(--text-secondary)]"
                  title="광고 = 수집된 전체 / 영상 후보 = 영상·기타 타입 / YouTube 매칭 = 영상 ID 추출 성공 / 고유 영상 = youtubeId 중복 제거"
                >
                  광고{" "}
                  <span className="font-semibold tabular-nums text-ink">
                    {totalAds}
                  </span>
                  <span className="mx-1.5 text-[var(--text-muted)]">·</span>
                  영상 후보{" "}
                  <span className="font-semibold tabular-nums text-ink">
                    {totalEligible}
                  </span>
                  <span className="mx-1.5 text-[var(--text-muted)]">·</span>
                  YouTube 매칭{" "}
                  <span className="font-semibold tabular-nums text-ink">
                    {totalMatched}
                  </span>
                  <span className="mx-1.5 text-[var(--text-muted)]">·</span>
                  고유 영상{" "}
                  <span className="font-semibold tabular-nums text-ink">
                    {totalAdVideos}
                  </span>
                </div>
                {/* 상한에 걸리면 조용히 자르지 않고 알린다 — 안 그러면 아래
                    광고주/채널 필터에 일부 광고주만 뜨는 걸 버그로 오해한다. */}
                {ads.length >= INITIAL_ADS_LIMIT && (
                  <span
                    className="badge badge-warning h-auto min-h-[22px] whitespace-normal py-0.5"
                    title={`첫 로딩은 최근 수집순 ${INITIAL_ADS_LIMIT}건까지만 가져옵니다. 브랜드 목록에서 브랜드를 클릭하면 그 브랜드 전체를 불러옵니다.`}
                  >
                    <TriangleAlert size={12} strokeWidth={2} aria-hidden className="shrink-0" />
                    최근 {INITIAL_ADS_LIMIT.toLocaleString()}건만 불러옴 —
                    브랜드 목록에서 브랜드를 클릭하면 전체 로드
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={copyLinks}
                    disabled={sortedAds.length === 0}
                    title="보이는 광고의 YouTube 링크를 '브랜드 | URL' 형식으로 복사 — ad-factory refs/inbox/list.txt 에 붙여넣기"
                    className="btn btn-secondary btn-sm"
                  >
                    {copiedCount !== null ? (
                      <>
                        <CircleCheck size={14} strokeWidth={1.75} aria-hidden />
                        {copiedCount}개 복사됨
                      </>
                    ) : (
                      <>
                        <Copy size={14} strokeWidth={1.75} aria-hidden />
                        전체 YouTube 링크 복사
                      </>
                    )}
                  </button>
                  <button
                    onClick={downloadCSV}
                    disabled={sortedAds.length === 0}
                    className="btn btn-secondary btn-sm"
                  >
                    <Download size={14} strokeWidth={1.75} aria-hidden />
                    CSV
                  </button>
                  <button
                    onClick={downloadJSON}
                    disabled={sortedAds.length === 0}
                    className="btn btn-secondary btn-sm"
                  >
                    <Download size={14} strokeWidth={1.75} aria-hidden />
                    JSON
                  </button>
                </div>
              </div>

              {/* ===== 필터 (v2 §10.4) =====
                  1행: 분석 기간 · 상태 — 가장 자주 바꾸는 핵심 두 가지만.
                  나머지(주력/상승세, 조회수·나이 대역, 결과 내 검색, 유형,
                  광고주·채널)는 "필터 더보기" 뒤로 접는다. 활성 개수는 버튼에. */}
              <section className="panel p-4" aria-label="광고 필터">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  {/* 분석 기간 셀렉터 — delta/%/D+N 컬럼이 이 윈도우 기준으로
                      계산됨. 7일이 default. "전체"는 snapshot 첫~끝 사용. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
                      <Calendar size={14} strokeWidth={1.75} aria-hidden className="text-faint" />
                      분석 기간
                    </span>
                    <div className="segmented">
                      {(["all", 7, 14, 30, 90] as const).map((d) => (
                        <button
                          key={String(d)}
                          onClick={() => setAnalyzeDays(d)}
                          aria-pressed={analyzeDays === d}
                        >
                          {d === "all" ? "전체" : `${d}일`}
                        </button>
                      ))}
                    </div>
                    <span className="text-sm text-muted">
                      변화·성장률 컬럼 기준
                    </span>
                  </div>

                  {/* 상태 분류 chip 필터 — classifyAd 결과 중 한 가지를 골라 필터.
                      스크린샷의 레퍼런스 대시보드 "스파이크/신규/히어로/피로도" 패턴. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
                      <Tag size={14} strokeWidth={1.75} aria-hidden className="text-faint" />
                      상태
                    </span>
                    <button
                      onClick={() => setClassFilter("all")}
                      aria-pressed={classFilter === "all"}
                      className="chip"
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
                          aria-pressed={active}
                          className="chip"
                        >
                          <m.Icon size={12} strokeWidth={2} aria-hidden className={active ? undefined : m.text} /> {m.label}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setAdsMoreFiltersOpen((open) => !open)}
                    aria-expanded={adsMoreFiltersOpen}
                    aria-controls="ads-more-filters"
                    className="btn btn-secondary btn-sm ml-auto"
                  >
                    <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden />
                    필터 더보기
                    {adsMoreFilterCount > 0 && (
                      <span className="badge badge-accent h-5 px-1.5 tabular-nums">
                        {adsMoreFilterCount}
                        <span className="sr-only">개 적용 중</span>
                      </span>
                    )}
                    {adsMoreFiltersOpen ? (
                      <ChevronUp size={14} strokeWidth={1.75} aria-hidden />
                    ) : (
                      <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
                    )}
                  </button>
                </div>

                {adsMoreFiltersOpen && (
                  <div
                    id="ads-more-filters"
                    className="mt-4 space-y-3 border-t border-line pt-4"
                  >
                    {/* 결과 내 검색 — 한 광고주(예: 모브랜드사)에 brand 가 여러
                        개 섞일 때 "브랜드D" / "브랜드E" 입력으로 좁힘. 제목/채널/
                        광고주명 contains 매칭. · 유형 세그먼트 */}
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="relative flex items-center gap-1">
                        <Search size={16} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                        <input
                          value={innerSearch}
                          onChange={(e) => setInnerSearch(e.target.value)}
                          placeholder="결과 내 검색 (제목/채널/광고주)"
                          aria-label="결과 내 검색"
                          className="field-input w-72 max-w-full py-1 pl-9"
                        />
                        {innerSearch && (
                          <button
                            onClick={() => setInnerSearch("")}
                            title="검색 지우기"
                            aria-label="검색 지우기"
                            className="btn btn-ghost btn-sm btn-icon"
                          >
                            <X size={14} strokeWidth={1.75} aria-hidden />
                          </button>
                        )}
                      </div>
                      <div className="segmented" role="group" aria-label="광고 유형">
                        {(
                          ["all", "youtube", "image", "video", "other"] as const
                        ).map((t) => (
                          <button
                            key={t}
                            onClick={() => setAdTypeFilter(t)}
                            aria-pressed={adTypeFilter === t}
                            className="inline-flex items-center gap-1.5"
                          >
                            {t === "youtube" && <Clapperboard size={14} strokeWidth={1.75} aria-hidden />}
                            {t === "all"
                              ? "전체"
                              : t === "youtube"
                              ? "YouTube"
                              : t === "image"
                              ? "이미지"
                              : t === "video"
                              ? "영상"
                              : "기타"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 성과 chip · 이 도메인만 · 조회수 대역 + 소재 나이 콤보 */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setFilter(filter === "hero" ? "all" : "hero")}
                        aria-pressed={filter === "hero"}
                        className="chip"
                      >
                        <Star size={14} strokeWidth={1.75} aria-hidden />
                        주력 소재 50만+
                      </button>
                      <button
                        onClick={() =>
                          setFilter(filter === "growing" ? "all" : "growing")
                        }
                        aria-pressed={filter === "growing"}
                        className="chip"
                      >
                        <TrendingUp size={14} strokeWidth={1.75} aria-hidden />
                        상승세 10만+ 또는 일 3천+
                      </button>
                      {/* 이 도메인만 토글 — Stage3 형제 brand 제거. 도메인 모드
                          검색일 때만 (via 데이터 있을 때만) 표시. 재수집 안 한
                          레거시 광고는 다 빠지니까 (n) 으로 명시. */}
                      {hasDomainModeAds && (
                        <button
                          onClick={() => setDomainOnly((v) => !v)}
                          title="같은 광고주가 굴리는 다른 브랜드 광고를 숨기고, 검색한 도메인이 직접 띄운 것만 표시"
                          aria-pressed={domainOnly}
                          className="chip tabular-nums"
                        >
                          <Target size={14} strokeWidth={1.75} aria-hidden />
                          이 도메인만 ({domainAdsCount})
                        </button>
                      )}
                      {/* 조회수 대역 + 소재 나이 콤보 — 레퍼런스 도구 벤치마크.
                          메가히트/롱런(검증된 소재) 만 골라보기. */}
                      <select
                        value={viewBand}
                        onChange={(e) => setViewBand(e.target.value)}
                        className={`h-8 rounded-sm border px-2 text-sm ${
                          viewBand
                            ? "border-accent-line bg-accent-soft font-semibold text-accent-ink"
                            : "border-line-control bg-surface text-muted"
                        }`}
                        title="조회수 대역 필터"
                        aria-label="조회수 대역"
                      >
                        <option value="">조회수 전체</option>
                        <option value="0:30000">~3만 (테스트)</option>
                        <option value="30000:300000">3만~30만</option>
                        <option value="300000:3000000">30만~300만 (통한 소재)</option>
                        <option value="3000000:20000000">300만~2000만 (대형)</option>
                        <option value="20000000:">2000만+ (전국구)</option>
                      </select>
                      <select
                        value={ageBand}
                        onChange={(e) => setAgeBand(e.target.value)}
                        className={`h-8 rounded-sm border px-2 text-sm ${
                          ageBand
                            ? "border-accent-line bg-accent-soft font-semibold text-accent-ink"
                            : "border-line-control bg-surface text-muted"
                        }`}
                        title="소재 나이 — 오래 살아남은 광고 = 검증된 소재"
                        aria-label="소재 나이"
                      >
                        <option value="">나이 전체</option>
                        <option value="old:21">3주+ (살아남은 소재)</option>
                        <option value="old:60">2개월+ (검증된 소재)</option>
                      </select>
                      <span className="text-sm text-muted">
                        조회수 밑 XXX회/일 = 게시일 기준 하루 평균 조회수
                      </span>
                    </div>

                    {/* Advertiser chips */}
                    {advertiserGroups.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-muted">
                          광고주
                        </span>
                        {advertiserGroups.slice(0, 8).map((g) => (
                          <a
                            key={g.id}
                            href={`https://adstransparency.google.com/advertiser/${g.id}?region=KR`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="chip"
                          >
                            {g.name || "(이름 없음)"}{" "}
                            <span className="font-semibold tabular-nums text-ink">
                              {g.count}
                            </span>
                          </a>
                        ))}
                      </div>
                    )}

                    {/* 채널 chip multi-select — 한 광고주(예: 모브랜드사) 안에
                        brand(브랜드D/브랜드E/브랜드F) 가 여러 채널로 갈릴 때 클릭
                        toggle 로 좁힘. 2개 이상일 때만 표시. innerSearch 와 AND. */}
                    {channelChips.length >= 2 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-muted">
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
                              aria-pressed={active}
                              className="chip"
                            >
                              {c.label}{" "}
                              <span className="font-semibold tabular-nums">
                                {c.count}
                              </span>
                            </button>
                          );
                        })}
                        {selectedChannels.size > 0 && (
                          <button
                            onClick={() => setSelectedChannels(new Set())}
                            className="btn btn-ghost btn-sm"
                          >
                            <X size={14} strokeWidth={1.75} aria-hidden />
                            채널 필터 해제 ({selectedChannels.size})
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Unified ads table — 항상 200개 cap. brand 선택해도 한 번에
                  너무 많은 썸네일 (mqdefault.jpg 수천 개) 동시 fetch 하면
                  네트워크 40초+. "더 보기" 클릭 시 +200 추가. */}
              {selectedKeyword && (
                <div className="flex justify-end">
                  <div className="segmented">
                    <button type="button" onClick={() => setAdView("cards")} aria-pressed={adView === "cards"}>
                      카드 보기
                    </button>
                    <button type="button" onClick={() => setAdView("table")} aria-pressed={adView === "table"}>
                      표 보기
                    </button>
                  </div>
                </div>
              )}
              <AdSelectionToolbar
                selectedAds={selectedFilteredAds}
                visibleCount={visibleTableAds.length}
                visibleLabel={`표시 ${visibleTableGroups.length}행 · 광고 ${visibleTableAds.length}개`}
                onSelectAll={() => toggleAdIds(visibleTableAds.map((ad) => ad.creativeId), true)}
                onClear={() => setSelectedAdIds(new Set())}
              />
              <AdsTable
                groups={visibleTableGroups}
                selectedIds={selectedAdIds}
                onToggleGroup={toggleAdIds}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                analyzeDays={analyzeDays}
                activeKeyword={selectedKeyword}
              />
              {groupedAds.length > displayLimit && (
                <div className="panel flex flex-wrap items-center justify-center gap-3 border-dashed px-4 py-3 text-center text-sm tabular-nums text-muted">
                  광고 {displayLimit.toLocaleString()}/{groupedAds.length.toLocaleString()}개 표시 중
                  <button
                    onClick={() => setDisplayLimit((n) => n + 200)}
                    className="btn btn-secondary btn-sm"
                  >
                    <Plus size={14} strokeWidth={1.75} aria-hidden />
                    200개 더 보기
                  </button>
                </div>
              )}
            </>
          ) : null}
        </main>
      </div>
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
      ? "border-warning text-warning"
      : accent === "rose"
      ? "border-danger text-danger"
      : accent === "indigo"
      ? "border-accent text-accent-ink"
      : "border-success text-success";
  const badgeClasses =
    active && accent === "amber"
      ? "bg-warning-soft text-warning"
      : active && accent === "rose"
      ? "bg-danger-soft text-danger"
      : active && accent === "emerald"
      ? "bg-success-soft text-success"
      : active && accent === "indigo"
      ? "bg-accent-soft text-accent-ink"
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
          className={`ml-1.5 rounded-xs px-1.5 py-0.5 text-xs ${badgeClasses}`}
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
      ? "text-success"
      : l === "error"
      ? "text-danger"
      : l === "warn"
      ? "text-warning"
      : "text-[var(--text-secondary)]";

  return (
    <section className="panel p-5" aria-busy={busy}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-base">
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${
              busy ? "animate-pulse bg-accent" : "bg-success"
            }`}
          />
          <span className="inline-flex flex-wrap items-center gap-1 font-semibold">
            {busy ? "수집 중" : "완료"}
            <span className="ml-1 text-sm font-normal text-faint">
              · &quot;{keyword}&quot;
            </span>
            {progress.step && (
              <span className="inline-flex items-center gap-1 font-normal text-muted">
                ·
                {(() => {
                  const PhaseIcon = phaseIcon(progress.step);
                  return PhaseIcon ? <PhaseIcon size={14} strokeWidth={1.75} aria-hidden /> : null;
                })()}
                {phaseLabel(progress.step)}
              </span>
            )}
          </span>
          <span className="text-sm tabular-nums text-faint">
            {progress.percent}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          {activeKeywords.length > 1 && (
            <div className="flex items-center gap-1 text-sm text-[var(--text-muted)]">
              <span>다른 진행:</span>
              {activeKeywords
                .filter((k) => k !== keyword)
                .slice(0, 3)
                .map((k) => (
                  <button
                    key={k}
                    onClick={() => onSelectKeyword(k)}
                    className="chip h-6"
                  >
                    {k}
                  </button>
                ))}
            </div>
          )}
          {!busy && (
            <button
              onClick={onClear}
              className="btn btn-ghost btn-sm"
            >
              로그 지우기
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="progress mb-3">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      {/* Log lines */}
      <div
        ref={scrollRef}
        className="max-h-72 overflow-y-auto rounded-sm border border-line bg-surface-soft p-3 font-mono text-sm leading-relaxed"
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
      aria-sort={active ? (sortDir === "desc" ? "descending" : "ascending") : undefined}
      className={align === "right" ? "text-right" : "text-left"}
    >
      <button
        onClick={() => onSort(thisKey)}
        className={`inline-flex items-center gap-1 transition-colors ${
          active
            ? "text-ink"
            : "text-muted hover:text-ink"
        }`}
      >
        {label}
        {active ? (
          sortDir === "desc" ? (
            <ArrowDown size={12} strokeWidth={2} aria-hidden />
          ) : (
            <ArrowUp size={12} strokeWidth={2} aria-hidden />
          )
        ) : (
          <ArrowUpDown size={12} strokeWidth={2} aria-hidden className="text-faint" />
        )}
      </button>
    </th>
  );
}

function AdsTable({
  groups,
  selectedIds,
  onToggleGroup,
  sortKey,
  sortDir,
  onSort,
  onDissect,
  analyzeDays,
  activeKeyword,
}: {
  groups: { primary: Ad; siblings: Ad[]; count: number }[];
  selectedIds: ReadonlySet<string>;
  onToggleGroup: (ids: readonly string[], checked: boolean) => void;
  sortKey: AdSortKey;
  sortDir: SortDir;
  onSort: (key: AdSortKey) => void;
  onDissect?: (youtubeId: string, creativeId: string | null) => void;
  analyzeDays: AnalyzeDays;
  activeKeyword: string | null;
}) {
  if (groups.length === 0) {
    return (
      <div className="panel empty text-base text-muted">
        <span className="empty-icon mb-3">
          <LayoutList size={20} strokeWidth={1.75} aria-hidden />
        </span>
        {activeKeyword ? (
          <>
            <b className="font-semibold text-ink">{activeKeyword}</b>에서
            불러온 광고가 없어요.
            <div className="mt-2 text-sm">
              위 로그의 ATC 직접 확인 링크로 실제 공개 여부를 확인할 수 있어요.
            </div>
          </>
        ) : (
          <>
            아직 불러온 광고가 없어요. 브랜드 아카이브 검색창에 브랜드명이나 도메인을 넣어보세요.
            <div className="mt-2 text-sm">예: 올리브영 · oliveyoung.co.kr</div>
          </>
        )}
      </div>
    );
  }
  return (
    <section className="panel">
      <div className="overflow-x-auto" tabIndex={0} aria-label="구글 광고 표">
        <table className="data-table min-w-[1120px]">
          <thead>
            <tr>
              <th className="text-left">
                <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" aria-label="표에 표시된 광고 전체 선택"
                  checked={groups.every((group) => group.siblings.every((ad) => selectedIds.has(ad.creativeId)))}
                  onChange={(event) => onToggleGroup(groups.flatMap((group) => group.siblings.map((ad) => ad.creativeId)), event.target.checked)} />
              </th>
              <th className="text-left">#</th>
              <th className="text-left">썸네일</th>
              <th className="text-left">제목</th>
              <th className="text-left">광고</th>
              <th className="text-left">YouTube</th>
              <th className="text-left">유형</th>
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
                selected={g.siblings.every((ad) => selectedIds.has(ad.creativeId))}
                onSelect={(checked) => onToggleGroup(g.siblings.map((ad) => ad.creativeId), checked)}
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
      aria-label={
        state === "busy"
          ? "받는 중"
          : state === "error"
          ? "다운로드 실패"
          : "mp4 로 저장"
      }
      aria-busy={state === "busy"}
      className={`inline-grid h-7 w-7 place-items-center rounded-sm transition-colors ${
        state === "error"
          ? "bg-danger-soft text-danger"
          : "text-faint hover:bg-surface-soft hover:text-ink"
      } disabled:cursor-wait disabled:opacity-60`}
    >
      {state === "busy" ? (
        <Hourglass size={14} strokeWidth={1.75} aria-hidden />
      ) : state === "error" ? (
        <TriangleAlert size={14} strokeWidth={1.75} aria-hidden />
      ) : (
        <Download size={14} strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
}

function AdRow({
  group,
  index,
  selected,
  onSelect,
  highlightDaily = false,
  highlightDelta = false,
  highlightGrowth = false,
  onDissect,
  analyzeDays,
}: {
  group: { primary: Ad; siblings: Ad[]; count: number };
  index: number;
  selected: boolean;
  onSelect: (checked: boolean) => void;
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
    ? "이미지 광고 (텍스트 없음 — ATC 보기)"
    : "카피 추출 실패 — ATC 보기";
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
    <tr className={`border-t border-line transition-colors ${selected ? "bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-surface-soft"}`}>
      <td>
        <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" aria-label={`광고 행 ${index} 선택${group.count > 1 ? ` (${group.count}개 소재)` : ""}`}
          checked={selected} onChange={(event) => onSelect(event.target.checked)} />
      </td>
      <td className="text-sm tabular-nums text-faint">{index}</td>
      <td>
        <ThumbnailCell ad={ad} />
      </td>
      <td className="max-w-md">
        <div className="flex items-start gap-1.5">
          <div className="line-clamp-2 text-base font-medium text-[var(--text-primary)]">
            {title}
          </div>
          {variantCount > 1 && (
            <span
              className="badge badge-neutral shrink-0 tabular-nums"
              title={`이 영상이 ${variantCount}개의 광고 크리에이티브로 사용 중`}
            >
              <Clapperboard size={12} strokeWidth={2} aria-hidden />
              {variantCount}
            </span>
          )}
        </div>
        {ad.advertiserName && (
          <div className="mt-0.5 truncate text-sm text-[var(--text-secondary)]">
            <span className="text-sm text-[var(--text-muted)]">광고주:</span>{" "}
            <span className="font-medium">{ad.advertiserName}</span>
            {isShellAd(ad) && (
              <span
                className="badge badge-neutral ml-1.5"
                title="투명성 센터 도메인 인덱스에 안 잡히는 대행 채널 광고. YouTube 채널 업로드 목록에서 찾아낸 것."
              >
                <Bird size={12} strokeWidth={2} aria-hidden />
                shell
              </span>
            )}
            {ad.ytChannel && ad.ytChannel !== ad.advertiserName && (
              <>
                <span className="mx-1.5 text-[var(--text-muted)]">·</span>
                <span className="text-sm text-[var(--text-muted)]">채널:</span>{" "}
                <span className="text-[var(--text-secondary)]">
                  {ad.ytChannel}
                </span>
              </>
            )}
          </div>
        )}
        {subtitle && (
          <div
            className="mt-0.5 line-clamp-3 text-sm italic text-[var(--text-muted)]"
            title={`광고 카피: ${subtitle}`}
          >
            <FileText size={12} strokeWidth={2} aria-hidden className="mr-1 inline align-[-1px] not-italic" />
            {subtitle}
          </div>
        )}
      </td>
      <td>
        <div className="flex items-center gap-1.5">
        {variantCount === 1 ? (
          <a
            href={atcLink(ad)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-accent hover:underline"
          >
            보기
          </a>
        ) : (
          <details className="group relative">
            <summary
              className="inline-flex cursor-pointer list-none items-center gap-0.5 whitespace-nowrap text-sm font-medium text-accent hover:underline"
              title={`이 영상이 ${variantCount}개 크리에이티브로 사용 중`}
            >
              {variantCount}개
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 z-10 mt-1 max-h-64 min-w-32 overflow-y-auto rounded-panel border border-line bg-surface p-1 shadow-popover">
              {group.siblings.map((s, i) => (
                <a
                  key={s.id}
                  href={atcLink(s)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block whitespace-nowrap rounded-sm text-sm text-ink hover:bg-surface-soft"
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
      <td>
        {hasYt ? (
          <div className="flex items-center gap-1">
            <a
              href={ytLink(ad.youtubeId!)}
              target="_blank"
              rel="noopener noreferrer"
              title="YouTube에서 보기"
              aria-label="YouTube에서 보기"
              className="inline-grid h-7 w-7 place-items-center rounded-sm text-muted transition-colors hover:bg-surface-soft hover:text-ink"
            >
              <Clapperboard size={14} strokeWidth={1.75} aria-hidden />
            </a>
            {onDissect && (
              <button
                onClick={() =>
                  onDissect(ad.youtubeId!, ad.creativeId ?? null)
                }
                title="똑같이만들기 — 자막+컷+썸네일 자동 분해"
                aria-label="똑같이만들기"
                className="inline-grid h-7 w-7 place-items-center rounded-sm text-muted transition-colors hover:bg-surface-soft hover:text-ink"
              >
                <Scissors size={14} strokeWidth={1.75} aria-hidden />
              </button>
            )}
          </div>
        ) : (
          <span className="text-[var(--text-muted)]">-</span>
        )}
      </td>
      <td>
        <TypeBadge ad={ad} />
      </td>
      {/* D+N + 게시일 합쳐서 한 셀. whitespace-nowrap으로 줄바꿈 방지. */}
      <td className="whitespace-nowrap text-sm">
        {dN !== null ? (
          <div className="font-semibold text-[var(--text-primary)]">
            D+{dN}
          </div>
        ) : (
          <div className="text-[var(--text-muted)]">-</div>
        )}
        <div className="mt-0.5 text-xs text-[var(--text-muted)]">
          {ad.ytPublishedAt ?? formatUnixDate(ad.firstSeen)}
        </div>
      </td>
      {/* 조회수 — "회" 단위 제거 (헤더에 이미 표시). 큰 숫자는 K/M 축약. */}
      <td className="whitespace-nowrap text-right tabular-nums">
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
          변화·성장률 중복이라 한 컬럼으로 통합. +300%↑엔 Flame 아이콘. AdStat
          스냅샷 2개+ 있어야 계산 (매일 cron 누적). */}
      <td className="whitespace-nowrap text-right tabular-nums text-sm">
        {change.hasData ? (
          <>
            <div
              className={
                change.percent > 0
                  ? highlightGrowth
                    ? "font-semibold text-success"
                    : "font-semibold text-success"
                  : change.percent < 0
                  ? "font-semibold text-danger"
                  : "text-[var(--text-secondary)]"
              }
              title={`평균 ${change.avgPerDay >= 0 ? "+" : ""}${change.avgPerDay.toLocaleString()}/일 (${change.daysSpan}일)`}
            >
              {change.percent >= 300 && (
                <Flame size={12} strokeWidth={2} aria-hidden className="mr-0.5 inline align-[-1px]" />
              )}
              {change.percent > 0 ? (
                <TrendingUp size={12} strokeWidth={2} aria-hidden className="mr-0.5 inline align-[-1px]" />
              ) : change.percent < 0 ? (
                <TrendingDown size={12} strokeWidth={2} aria-hidden className="mr-0.5 inline align-[-1px]" />
              ) : null}
              {change.percent > 0 ? "+" : ""}
              {change.percent.toFixed(1)}%
            </div>
            <div className="mt-0.5 text-sm text-[var(--text-muted)]">
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
      <td className="whitespace-nowrap text-right tabular-nums">
        {hasYt && ad.ytViews !== null ? (
          <span
            className={
              highlightDaily
                ? "font-semibold text-ink"
                : "text-muted"
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
      <td>
        {classes.length === 0 ? (
          <span className="text-sm text-[var(--text-muted)]">—</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {classes.slice(0, 3).map((c) => {
              const m = CLASSIFICATION_META[c];
              return (
                <span
                  key={c}
                  title={m.tip}
                  className={`badge ${m.bg} ${m.text}`}
                >
                  <m.Icon size={12} strokeWidth={2} aria-hidden /> {m.label}
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
          className="h-16 w-28 rounded-xs object-cover"
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
        className="block h-16 w-28 overflow-hidden rounded-xs bg-[var(--bg-elev)]"
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
        className="block h-16 w-28 overflow-hidden rounded-xs bg-[var(--bg-elev)]"
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
    <div className="flex h-16 w-28 items-center justify-center rounded-xs bg-surface-sunken text-faint">
      {ad.type === "video" ? (
        <Clapperboard size={20} strokeWidth={1.75} aria-hidden />
      ) : (
        <Package size={20} strokeWidth={1.75} aria-hidden />
      )}
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
        className="badge badge-neutral"
      >
        <Clapperboard size={12} strokeWidth={2} aria-hidden />
        영상
      </span>
    );
  if (ad.type === "image")
    return (
      <span className="badge badge-neutral">
        <ImageIcon size={12} strokeWidth={2} aria-hidden />
        이미지
      </span>
    );
  if (ad.type === "video")
    return (
      <span
        title="직접업로드 (YouTube에 없음)"
        className="badge badge-neutral"
      >
        <Upload size={12} strokeWidth={2} aria-hidden />
        직업로드
      </span>
    );
  return (
    <span className="badge badge-neutral">
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
  // v2 §10.4 — 보조 필터는 "필터 더보기" 뒤로. 활성 개수를 버튼에 표시.
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const moreFilterCount =
    (poolViewBand ? 1 : 0) +
    (poolAgeBand ? 1 : 0) +
    (poolSearch.trim() ? 1 : 0) +
    (domainFilter ? 1 : 0);

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
      <div className="panel empty text-base text-muted">
        <span className="empty-icon mb-3">
          <Clapperboard size={20} strokeWidth={1.75} aria-hidden />
        </span>
        <h3 className="text-base font-semibold text-ink">아직 영상 광고가 하나도 없어요.</h3>
        <div className="mt-2 text-sm">
          브랜드 아카이브 검색창에 도메인이나 브랜드명을 먼저 넣어보세요. (예: 올리브영)
        </div>
      </div>
    );
  }
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <h2>
            <TrendingUp size={16} strokeWidth={1.75} aria-hidden />
            소재 분석 (전체 누적)
          </h2>
        </div>
        <p className="panel-body text-base text-muted">
          지금까지 불러온 <b>모든 도메인의 영상 광고를 한 화면에서</b> 봅니다.
          같은 영상은 한 줄로 묶이고, 며칠에 걸쳐 다시 불러올수록 일별 조회수가
          쌓여서 <b>상승세 · 급등 · 둔화</b>가 자동으로 붙어요. 아래{" "}
          <b>광고주 필터</b>로 도메인 하나만 보거나, 브랜드 목록의{" "}
          <Star size={12} strokeWidth={2} aria-label="별" className="inline align-[-1px]" />로 매일 자동
          갱신되게 할 수 있습니다.
        </p>
      </section>

      {/* 상단 지표 4개 — 레퍼런스 도구 "소재만보기" 스타일. 필터 반영 실시간.
          v2 §10.2/10.6: 값 28px, 개수에 맞춰 한 줄(좁으면 2+2). */}
      <div className="stat-row">
        <div className="stat-grid" data-count="4">
          {[
            { label: "광고 캠페인", value: poolStats.campaigns, hint: "같은 영상 재사용 포함" },
            { label: "고유 영상 (dedup)", value: poolStats.unique, hint: "YouTube 영상 기준" },
            { label: "조회수 합계", value: poolStats.viewsSum, hint: "고유 영상 합", format: true },
            { label: "업체 수", value: poolStats.owners, hint: "keyword 기준" },
          ].map((s) => (
            <div key={s.label} className="panel stat-tile">
              <div className="stat-label">{s.label}</div>
              <div className="stat-value">
                {s.format ? formatCompactNum(s.value) : s.value.toLocaleString()}
              </div>
              <div className="stat-hint">{s.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ===== 필터 (v2 §10.4) =====
          1행: 분류(상태) 칩만. 조회수·나이 대역, 제목/업체 검색, 광고주
          필터는 "필터 더보기" 뒤로 접는다. 활성 개수는 버튼에 표시. */}
      <section className="panel p-4" aria-label="소재 필터">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
            <Tag size={14} strokeWidth={1.75} aria-hidden className="text-faint" />
            분류
          </span>
          <button
            onClick={() => onClassFilterChange("all")}
            aria-pressed={classFilter === "all"}
            className="chip"
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
                aria-pressed={active}
                className="chip disabled:cursor-not-allowed disabled:opacity-50"
                disabled={count === 0}
                title={count === 0 ? `${meta.label}: 해당 없음` : meta.tip}
              >
                <meta.Icon size={12} strokeWidth={2} aria-hidden className={active ? undefined : meta.text} /> {meta.label}{" "}
                <span className="tabular-nums opacity-80">{count}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreFiltersOpen((open) => !open)}
            aria-expanded={moreFiltersOpen}
            aria-controls="creatives-more-filters"
            className="btn btn-secondary btn-sm ml-auto"
          >
            <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden />
            필터 더보기
            {moreFilterCount > 0 && (
              <span className="badge badge-accent h-5 px-1.5 tabular-nums">
                {moreFilterCount}
                <span className="sr-only">개 적용 중</span>
              </span>
            )}
            {moreFiltersOpen ? (
              <ChevronUp size={14} strokeWidth={1.75} aria-hidden />
            ) : (
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
            )}
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">
          ※ 가속도/스파이크/피로도는 일별 스냅샷이 2개 이상 쌓여야 분류됩니다
        </p>

        {moreFiltersOpen && (
          <div
            id="creatives-more-filters"
            className="mt-4 space-y-3 border-t border-line pt-4"
          >
            {/* 소재풀 필터 행 — 조회수 대역 / 나이 / 검색 */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={poolViewBand}
                onChange={(e) => setPoolViewBand(e.target.value)}
                aria-label="조회수 대역"
                className={`h-8 rounded-sm border px-2 text-sm ${
                  poolViewBand
                    ? "border-accent-line bg-accent-soft font-semibold text-accent-ink"
                    : "border-line-control bg-surface text-muted"
                }`}
              >
                <option value="">조회수 전체</option>
                <option value="0:30000">~3만 (테스트)</option>
                <option value="30000:300000">3만~30만</option>
                <option value="300000:3000000">30만~300만 (통한 소재)</option>
                <option value="3000000:20000000">300만~2000만 (대형)</option>
                <option value="20000000:">2000만+ (전국구)</option>
              </select>
              <select
                value={poolAgeBand}
                onChange={(e) => setPoolAgeBand(e.target.value)}
                aria-label="소재 나이"
                className={`h-8 rounded-sm border px-2 text-sm ${
                  poolAgeBand
                    ? "border-accent-line bg-accent-soft font-semibold text-accent-ink"
                    : "border-line-control bg-surface text-muted"
                }`}
              >
                <option value="">나이 전체</option>
                <option value="old:21">3주+ (살아남은 소재)</option>
                <option value="old:60">2개월+ (검증된 소재)</option>
              </select>
              <div className="relative">
                <Search size={16} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  value={poolSearch}
                  onChange={(e) => setPoolSearch(e.target.value)}
                  placeholder="제목 / 업체명 검색..."
                  aria-label="제목 / 업체명 검색"
                  className="field-input w-64 max-w-full py-1 pl-9"
                />
              </div>
            </div>

            {/* Domain filter — opt-in scoping for this tab */}
            {domains.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-muted">
                  광고주 필터:
                </span>
                <button
                  onClick={() => onDomainFilterChange(null)}
                  aria-pressed={domainFilter === null}
                  className="chip tabular-nums"
                >
                  전체 ({domains.reduce((s, d) => s + d.count, 0)})
                </button>
                {domains.map((d) => (
                  <button
                    key={d.keyword}
                    onClick={() =>
                      onDomainFilterChange(domainFilter === d.keyword ? null : d.keyword)
                    }
                    aria-pressed={domainFilter === d.keyword}
                    className="chip"
                  >
                    {d.keyword}{" "}
                    <span className="tabular-nums opacity-80">({d.count})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 개수 · 정렬 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-base text-muted">
          영상{" "}
          <span className="font-semibold tabular-nums text-ink">
            {filtered.length}
          </span>
          개
          {classFilter !== "all" && (
            <span className="ml-2 text-sm text-faint">
              / 전체 {pool.length}개
            </span>
          )}
        </div>
        <button
          onClick={() => onSort("views")}
          aria-pressed={sort === "views"}
          className="chip"
        >
          <ChartNoAxesColumn size={14} strokeWidth={1.75} aria-hidden />
          누적 조회수
        </button>
        <button
          onClick={() => onSort("daily")}
          aria-pressed={sort === "daily"}
          className="chip"
        >
          <Zap size={14} strokeWidth={1.75} aria-hidden />
          일평균 조회수
        </button>
        <button
          onClick={() => onSort("campaigns")}
          aria-pressed={sort === "campaigns"}
          className="chip"
          title="같은 영상이 몇 개 광고 캠페인에 재사용됐나 — 많을수록 광고주가 돈 들여 검증한 소재"
        >
          <Package size={14} strokeWidth={1.75} aria-hidden />
          캠페인 수 많은순
          {sort === "campaigns" &&
            (sortDir === "desc" ? (
              <ArrowDown size={12} strokeWidth={2} aria-hidden />
            ) : (
              <ArrowUp size={12} strokeWidth={2} aria-hidden />
            ))}
        </button>
      </div>

      <section className="panel">
        <div className="overflow-x-auto" tabIndex={0} aria-label="소재 비교 표">
          <table className="data-table min-w-[1120px]">
            <thead>
              <tr>
                <th className="text-left">#</th>
                <th className="text-left">썸네일</th>
                <th className="text-left">제목</th>
                <th className="text-left">분류</th>
                <th className="text-left">광고주</th>
                <th className="text-left">YT</th>
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
                <th className="text-left">7일 추이</th>
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
                    className="border-t border-line transition-colors hover:bg-surface-soft"
                  >
                    <td className="text-sm tabular-nums text-faint">
                      {i + 1}
                    </td>
                    <td>
                      <ThumbnailCell ad={ad} />
                    </td>
                    <td className="max-w-md">
                      <div className="flex items-start gap-1.5">
                        <div className="line-clamp-2 text-base font-medium text-[var(--text-primary)]">
                          {ad.ytTitle ?? "(제목 없음)"}
                        </div>
                        {g.count > 1 && (
                          <span className="badge badge-neutral shrink-0 tabular-nums">
                            <Clapperboard size={12} strokeWidth={2} aria-hidden />
                            {g.count}
                          </span>
                        )}
                      </div>
                      {(ad.adHeadline || ad.adDescription) && (
                        <div
                          className="mt-0.5 line-clamp-1 text-sm italic text-[var(--text-muted)]"
                          title={
                            "광고 카피: " +
                            [ad.adHeadline, ad.adDescription]
                              .filter(Boolean)
                              .join(" · ")
                          }
                        >
                          <FileText size={12} strokeWidth={2} aria-hidden className="mr-1 inline align-[-1px]" />
                          {[ad.adHeadline, ad.adDescription]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {g.classes.length === 0 ? (
                          <span className="text-sm text-[var(--text-muted)]">
                            -
                          </span>
                        ) : (
                          g.classes.map((c) => {
                            const m = CLASSIFICATION_META[c];
                            return (
                              <span
                                key={c}
                                className={`badge ${m.bg} ${m.text}`}
                              >
                                <m.Icon size={12} strokeWidth={2} aria-hidden /> {m.label}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </td>
                    <td className="text-sm">
                      <div className="font-medium text-[var(--text-primary)]">
                        {ad.advertiserName || "-"}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-sm text-faint">
                        <Globe size={12} strokeWidth={2} aria-hidden className="shrink-0" />
                        {ad.keyword}
                      </div>
                      {ad.ytChannel && ad.ytChannel !== ad.advertiserName && (
                        <div className="flex items-center gap-1 text-sm text-muted">
                          <Tv size={12} strokeWidth={2} aria-hidden className="shrink-0" />
                          {ad.ytChannel}
                        </div>
                      )}
                    </td>
                    <td>
                      <a
                        href={ytLink(ad.youtubeId!)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="YouTube에서 보기"
                        aria-label="YouTube에서 보기"
                        className="inline-grid h-7 w-7 place-items-center rounded-sm text-muted transition-colors hover:bg-surface-soft hover:text-ink"
                      >
                        <Clapperboard size={14} strokeWidth={1.75} aria-hidden />
                      </a>
                    </td>
                    <td className="whitespace-nowrap text-sm text-[var(--text-secondary)]">
                      {ad.ytPublishedAt ?? "-"}
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      <span
                        className={
                          sort === "views"
                            ? "font-semibold text-[var(--text-primary)]"
                            : "text-[var(--text-primary)]"
                        }
                      >
                        {(ad.ytViews ?? 0).toLocaleString()}회
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      <span
                        className={
                          sort === "daily"
                            ? "font-semibold text-ink"
                            : "text-muted"
                        }
                      >
                        {dpd.toLocaleString()}회
                      </span>
                    </td>
                    <td>
                      <Sparkline stats={ad.stats ?? []} />
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums text-[var(--text-secondary)]">
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
      aria-sort={active ? (sortDir === "desc" ? "descending" : "ascending") : undefined}
      className={align === "right" ? "text-right" : "text-left"}
    >
      <button
        onClick={() => onSort(thisKey)}
        className={`inline-flex items-center gap-1 transition-colors ${
          active
            ? "text-ink"
            : "text-muted hover:text-ink"
        }`}
      >
        {label}
        {active ? (
          sortDir === "desc" ? (
            <ArrowDown size={12} strokeWidth={2} aria-hidden />
          ) : (
            <ArrowUp size={12} strokeWidth={2} aria-hidden />
          )
        ) : (
          <ArrowUpDown size={12} strokeWidth={2} aria-hidden className="text-faint" />
        )}
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
    return <span className="text-sm text-[var(--text-muted)]">-</span>;
  }
  if (stats.length === 1) {
    return (
      <span
        className="text-sm text-[var(--text-muted)]"
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
  // 선 색은 스위트 의미색 토큰(--success / --danger / --faint)을 currentColor 로 받는다.
  const strokeClass =
    lastDelta > 0 ? "text-success" : lastDelta < 0 ? "text-danger" : "text-faint";
  return (
    <div
      className="flex items-center gap-1.5"
      title={sorted
        .map((s) => `${s.capturedDate}: ${s.views.toLocaleString()}회`)
        .join("\n")}
    >
      <svg width={W} height={H} className={`overflow-visible ${strokeClass}`} aria-hidden>
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          points={pts}
        />
      </svg>
      <span
        className={`text-sm tabular-nums ${
          lastDelta > 0
            ? "text-success"
            : lastDelta < 0
            ? "text-danger"
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
    <section className="panel">
      <div className="overflow-x-auto" tabIndex={0} aria-label="YouTube 영상 표">
        <table className="data-table min-w-[900px]">
          <thead>
            <tr>
              <th className="text-left">#</th>
              <th className="text-left">제목</th>
              <th className="text-left">채널</th>
              <th className="text-left">키워드</th>
              <th className="text-left">유형</th>
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
                  className="px-3 py-12 text-center text-base text-[var(--text-muted)]"
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
                  <td className="text-[var(--text-muted)]">{i + 1}</td>
                  <td className="max-w-md">
                    <div className="flex items-start gap-2">
                      {v.thumbnail && (
                        <img
                          src={v.thumbnail}
                          alt=""
                          className="h-12 w-20 shrink-0 rounded-xs object-cover"
                          loading="lazy"
                        />
                      )}
                      <a
                        href={v.youtube}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="line-clamp-2 font-medium text-[var(--text-primary)] hover:text-danger"
                      >
                        {v.title}
                      </a>
                    </div>
                  </td>
                  <td className="text-[var(--text-secondary)]">
                    {v.channel}
                  </td>
                  <td className="text-sm text-[var(--text-muted)]">
                    {v.keyword}
                  </td>
                  <td>
                    <span
                      className={
                        v.type === "쇼츠"
                          ? "badge badge-accent"
                          : "badge badge-neutral"
                      }
                    >
                      {v.type}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-[var(--text-secondary)]">
                    {v.publishedAt}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {v.views.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {v.likes.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">
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
