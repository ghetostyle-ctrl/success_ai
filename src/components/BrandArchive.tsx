"use client";

/**
 * 브랜드 아카이브 — 수집한 브랜드를 카드 그리드로 훑는 첫 화면.
 *
 * 표(表)가 아니라 카드로 여는 이유: 광고 레퍼런스는 숫자보다 "어떤 그림을
 * 걸었나"가 먼저다. 카드 하나가 브랜드 하나고, 그 안에 최근 소재 썸네일을
 * 가로로 흘려서 한눈에 훑게 한다. 숫자로 파고들고 싶으면 카드를 눌러
 * 표 뷰(레퍼런스 탭)로 넘어간다.
 */

import { useMemo, useState } from "react";

export type ArchiveCreative = {
  creativeId: string;
  /** YouTube 썸네일 또는 ATC 미리보기 이미지. 둘 다 없으면 null. */
  thumb: string | null;
  title: string;
  /** 소재 성과 백분위 (조회수 기준, 같은 브랜드 안에서). 없으면 null. */
  percentile: number | null;
  views: number | null;
  /** 이 광고가 처음 잡힌 날짜 (YYYY.MM.DD). */
  firstSeenLabel: string | null;
  /** 아직 집행 중인지 — lastSeen 이 최근인지로 판정. */
  running: boolean;
  /** 집행 기간 일수. */
  runDays: number | null;
  link: string;
};

export type ArchiveBrand = {
  keyword: string;
  /** 대표 광고주명 (가장 광고가 많은 광고주). */
  advertiser: string | null;
  adCount: number;
  videoCount: number;
  region: string;
  creatives: ArchiveCreative[];
  /** 자동 추적 대상인지 — 사이드바 ⭐와 같은 상태. */
  tracked: boolean;
};

function fmtViews(n: number | null): string | null {
  if (n === null) return null;
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1)}만`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}천`;
  return String(n);
}

/** 브랜드 이니셜 — 아바타 자리에 쓸 한 글자. 한글이면 첫 글자, 영문이면 대문자. */
function initial(keyword: string): string {
  const stem = keyword.replace(/^www\./, "").split(".")[0];
  return (stem[0] ?? "?").toUpperCase();
}

/**
 * 도메인 문자열에서 색을 뽑는다. 브랜드마다 아바타 색이 고정돼야
 * 목록을 다시 열어도 같은 자리로 인식된다 (랜덤이면 매번 바뀐다).
 */
function avatarHue(keyword: string): number {
  let h = 0;
  for (let i = 0; i < keyword.length; i++) {
    h = (h * 31 + keyword.charCodeAt(i)) % 360;
  }
  return h;
}

function CreativeCard({ c }: { c: ArchiveCreative }) {
  const views = fmtViews(c.views);
  return (
    <a
      href={c.link}
      target="_blank"
      rel="noopener noreferrer"
      title={c.title}
      className="group relative block w-[150px] shrink-0"
    >
      <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elev)]">
        {/* 9:16 에 가까운 세로 비율 — 요즘 광고 소재 대부분이 세로다. */}
        <div className="relative aspect-[3/4] w-full">
          {c.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.thumb}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl text-[var(--text-muted)]">
              🖼
            </div>
          )}
          {c.percentile !== null && (
            <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
              👁 상위 {c.percentile}%
            </span>
          )}
          {views && (
            <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
              {views}
            </span>
          )}
        </div>
      </div>
      <div className="mt-1.5 line-clamp-2 text-[11px] leading-tight text-[var(--text-secondary)]">
        {c.title}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
        {c.firstSeenLabel && <span>{c.firstSeenLabel}</span>}
        <span className="flex items-center gap-1">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              c.running ? "bg-emerald-500" : "bg-slate-300"
            }`}
          />
          {c.running ? "게재 중" : "종료"}
        </span>
        {c.runDays !== null && <span>🗓 {c.runDays}일</span>}
      </div>
    </a>
  );
}

function BrandCard({
  brand,
  onOpen,
  onRefresh,
  busy,
}: {
  brand: ArchiveBrand;
  onOpen: (keyword: string) => void;
  onRefresh: (keyword: string) => void;
  busy: boolean;
}) {
  const hue = avatarHue(brand.keyword);
  return (
    <section className="mv-card overflow-hidden">
      {/* 헤더 — 아바타 / 브랜드 / 게재 수 / 액션 */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black text-white"
          style={{ background: `hsl(${hue} 62% 55%)` }}
        >
          {initial(brand.keyword)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onOpen(brand.keyword)}
              className="truncate text-sm font-bold text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline"
            >
              {brand.keyword}
            </button>
            <span className="shrink-0 rounded border border-[var(--border-strong)] px-1 text-[10px] font-medium text-[var(--text-muted)]">
              {brand.region}
            </span>
            {brand.tracked && (
              <span
                title="매일 자동으로 다시 불러옵니다"
                className="shrink-0 text-[11px]"
              >
                ⭐
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-[var(--text-muted)]">
            {brand.advertiser ?? "광고주 미확인"}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs font-semibold text-[var(--text-secondary)]">
            {brand.adCount.toLocaleString()}개 게재 중
          </div>
          <div className="text-[10px] text-[var(--text-muted)]">
            영상 {brand.videoCount.toLocaleString()}
          </div>
        </div>
        <button
          onClick={() => onRefresh(brand.keyword)}
          disabled={busy}
          title="지금 다시 불러오기"
          className="shrink-0 rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-white disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "⏳" : "🔄"}
        </button>
      </div>

      {/* 소재 캐러셀 */}
      <div className="border-t border-[var(--border)] px-4 py-3">
        <div className="mb-2 text-[11px] font-semibold text-[var(--text-secondary)]">
          최근 게재된 소재
        </div>
        {brand.creatives.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-[var(--text-muted)]">
            아직 소재가 없어요
          </div>
        ) : (
          <div className="mv-scroll-x flex gap-2.5 pb-1.5">
            {brand.creatives.map((c) => (
              <CreativeCard key={c.creativeId} c={c} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default function BrandArchive({
  brands,
  onOpen,
  onRefresh,
  busyKeywords,
  emptyHint,
}: {
  brands: ArchiveBrand[];
  onOpen: (keyword: string) => void;
  onRefresh: (keyword: string) => void;
  busyKeywords: Set<string>;
  emptyHint: React.ReactNode;
}) {
  const [sort, setSort] = useState<"ads" | "name">("ads");

  const sorted = useMemo(() => {
    const arr = [...brands];
    if (sort === "name") arr.sort((a, b) => a.keyword.localeCompare(b.keyword));
    else arr.sort((a, b) => b.adCount - a.adCount);
    return arr;
  }, [brands, sort]);

  if (brands.length === 0) {
    return (
      <div className="mv-card px-6 py-16 text-center text-sm text-[var(--text-muted)]">
        {emptyHint}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[var(--text-primary)]">
          내 브랜드{" "}
          <span className="font-medium text-[var(--text-muted)]">
            {brands.length}개
          </span>
        </h2>
        <div className="flex items-center gap-1 text-[11px]">
          {(
            [
              ["ads", "게재 많은 순"],
              ["name", "이름순"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`rounded-full px-2.5 py-1 font-medium transition ${
                sort === key
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-elev)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {sorted.map((b) => (
          <BrandCard
            key={b.keyword}
            brand={b}
            onOpen={onOpen}
            onRefresh={onRefresh}
            busy={busyKeywords.has(b.keyword)}
          />
        ))}
      </div>
    </div>
  );
}
