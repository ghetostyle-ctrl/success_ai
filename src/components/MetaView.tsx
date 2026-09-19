"use client";

/**
 * "📘 메타 광고" tab — Facebook + Instagram Ad Library collector.
 *
 * Layout (post-refactor):
 *   - One toolbar at the top: new-task input + horizontal job picker.
 *   - Single full-width detail pane below — replaces the old left
 *     work-list column so the global app sidebar is the only sidebar
 *     on screen.
 *   - Detail pane has a 광고 / 페이지 toggle so the same job can be
 *     viewed as ad cards or grouped-by-running-page.
 *   - Cards mirror Meta Ad Library's own card layout (square media,
 *     active badge + library id, page avatar header, body, lp domain
 *     footer with UTM badge + "더 알아보기" button).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Status = "queued" | "in_progress" | "complete" | "error";

type JobSummary = {
  id: string;
  keyword: string;
  region: string;
  status: Status;
  adCount: number;
  pageCount: number;
  errorMsg: string | null;
  createdAt: string;
};

type WatchInfo = {
  keyword: string;
  source: "seed" | "manual" | "auto";
  anchorKeyword: string | null;
};

type MetaAd = {
  adArchiveId: string;
  pageId: string;
  pageName: string;
  bodies: string[];
  linkTitles: string[];
  linkDescriptions: string[];
  linkCaptions: string[];
  snapshotUrl: string | null;
  startTime: string | null;
  stopTime: string | null;
  languages: string[];
  publisherPlatforms: string[];
  mediaUrl?: string | null;
  mediaType?: "video" | "image" | null;
  avatarUrl?: string | null;
  lpUrl?: string | null;
  lpDomain?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  savedAt: string;
};

// A-tier scoring extras attached server-side by /api/meta/anchor.
// `variantCount` ≥ 1, `ytTopViews` = max ATC YouTube views matched off
// any youtu.be id found in body/lpUrl, `ytMatches` = the resolved rows.
type ScoringExtras = {
  variantCount?: number;
  ytTopViews?: number;
  ytMatches?: {
    youtubeId: string;
    ytViews: number | null;
    ytTitle: string | null;
    ytChannel: string | null;
  }[];
  // Phase-2 Meta-direct enrichment. metaVariantCount is Meta's own
  // "광고 N개에서 이 크리에이티브 사용" — when set, takes precedence
  // over the body-hash variantCount heuristic.
  metaVariantCount?: number | null;
  librarySignalsFetchedAt?: string | null;
  // Phase-3a: BIT.LY-resolved final URL. When the chain ends on a
  // YouTube watch/shorts URL, resolvedYoutubeId is the 11-char id
  // (matches against ATC Ad.youtubeId for cross-platform scoring).
  resolvedLpUrl?: string | null;
  resolvedLpDomain?: string | null;
  resolvedYoutubeId?: string | null;
};

type JobDetail = {
  id: string;
  keyword: string;
  region: string;
  status: Status;
  adCount: number;
  pageCount: number;
  errorMsg: string | null;
  ads: (MetaAd & { sourceKeyword?: string } & ScoringExtras)[];
  logs: string[];
  // Aggregate-mode extras (only set when the detail came from
  // /api/meta/anchor/:anchor — a unified view spanning the brand
  // keyword + every page-id under it).
  isAggregate?: boolean;
  childKeywords?: string[];
  childWatches?: {
    keyword: string;
    source: string | null;
    lastRunAt: string | null;
    adCount: number;
    status: Status | null;
    metaResultCount?: number | null;
  }[];
  // Brand-level Σ "결과 ~N개" across all child watches (Meta's
  // claim of total ads currently surfaced for this brand).
  metaResultCountTotal?: number;
  // Phase-3b: cross-platform context. ATC YouTube ads under same brand.
  atcBrandSummary?: {
    totalVideos: number;
    totalViews: number;
    top5: {
      youtubeId: string | null;
      title: string | null;
      channel: string | null;
      views: number;
      advertiser: string;
    }[];
  };
  // Phase-2 enrichment progress for this anchor (live-polled).
  enrichment?: {
    status: "running" | "done" | "error";
    done: number;
    total: number;
    startedAt: number;
    finishedAt?: number;
    error?: string;
  } | null;
};

const STATUS_LABEL: Record<Status, string> = {
  queued: "🕒 대기",
  in_progress: "🔄 처리중",
  complete: "✅ 완료",
  error: "❌ 실패",
};
const STATUS_CLASS: Record<Status, string> = {
  queued: "bg-amber-500/15 text-amber-700",
  in_progress: "bg-blue-500/15 text-blue-700",
  complete: "bg-emerald-500/15 text-emerald-700",
  error: "bg-rose-500/15 text-rose-700",
};

function metaLibraryLink(adArchiveId: string) {
  return `https://www.facebook.com/ads/library/?id=${adArchiveId}`;
}

function platformBadge(p: string) {
  const map: Record<string, { label: string; cls: string }> = {
    FACEBOOK: { label: "FB", cls: "bg-blue-500/20 text-blue-700" },
    INSTAGRAM: { label: "IG", cls: "bg-pink-500/20 text-pink-700" },
    MESSENGER: { label: "MSG", cls: "bg-sky-500/20 text-sky-700" },
    AUDIENCE_NETWORK: {
      label: "AUD",
      cls: "bg-purple-500/20 text-purple-700",
    },
    THREADS: { label: "TH", cls: "bg-zinc-700/20 text-zinc-800" },
  };
  // "PLATFORM_1" 같은 placeholder 는 scraper 가 aria-label 매칭 실패 시
  // mask-position 갯수로만 채운 fallback. 노출하지 말고 "?" 로 묶음.
  // 다음 수집부터 한글 매칭으로 진짜 플랫폼 이름 채워짐.
  const isPlaceholder = /^PLATFORM_\d+$/.test(p);
  const m =
    map[p] ??
    (isPlaceholder
      ? { label: "?", cls: "bg-slate-400/20 text-slate-500" }
      : { label: p, cls: "bg-slate-500/20 text-slate-700" });
  return (
    <span
      key={p}
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${m.cls}`}
      title={isPlaceholder ? "플랫폼 정보 누락 (재수집 시 채워짐)" : p}
    >
      {m.label}
    </span>
  );
}

export default function MetaView({
  selectedKeyword,
}: {
  selectedKeyword?: string | null;
}) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [watches, setWatches] = useState<WatchInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [keyword, setKeyword] = useState("");
  const [enqueuing, setEnqueuing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Per-keyword metadata (source / anchor) for dropdown badges + grouping.
  const watchByKeyword = useMemo(() => {
    const m = new Map<string, WatchInfo>();
    for (const w of watches) m.set(w.keyword, w);
    return m;
  }, [watches]);

  const loadJobs = useCallback(async () => {
    const [jobsRes, watchesRes] = await Promise.all([
      fetch("/api/meta/list"),
      fetch("/api/meta-watch"),
    ]);
    if (jobsRes.ok) {
      const data = (await jobsRes.json()) as { jobs: JobSummary[] };
      setJobs(data.jobs);
    }
    if (watchesRes.ok) {
      const data = (await watchesRes.json()) as { watches: WatchInfo[] };
      setWatches(data.watches);
    }
  }, []);

  // Sidebar → Meta auto-link.
  // Priority order:
  //   1. ANCHOR MODE — if the sidebar passes a brand keyword that has
  //      ≥2 watches under it (seed + page-id children, etc.), switch
  //      to the unified /api/meta/anchor/:anchor view so all sock-puppet
  //      pages roll up into one card list. This is what the user means
  //      by "통합해서 보여줘".
  //   2. Exact-job match — single brand keyword with no children.
  //   3. Fuzzy stem match — handle "example.co.kr" → "예시브랜드" alias.
  useEffect(() => {
    if (!selectedKeyword) return;
    if (watches.length === 0 && jobs.length === 0) return;

    const childCount = watches.filter(
      (w) =>
        w.anchorKeyword === selectedKeyword || w.keyword === selectedKeyword
    ).length;
    if (childCount >= 2) {
      // Use synthetic anchor:* id so loadDetail routes to the aggregate
      // endpoint instead of /api/meta/:id.
      setCurrentId(`anchor:${selectedKeyword}`);
      return;
    }

    if (jobs.length === 0) return;
    const exact = jobs.find((j) => j.keyword === selectedKeyword);
    if (exact) {
      setCurrentId(exact.id);
      return;
    }
    const stem = selectedKeyword
      .replace(/\.(co\.kr|kr|com|net|io)$/i, "")
      .replace(/[^a-z0-9가-힣]/gi, "")
      .toLowerCase();
    if (!stem) return;
    const fuzzy = jobs.find((j) =>
      j.keyword.toLowerCase().replace(/[^a-z0-9가-힣]/gi, "").includes(stem)
    );
    if (fuzzy) setCurrentId(fuzzy.id);
  }, [selectedKeyword, jobs, watches]);

  const loadDetail = useCallback(async (id: string) => {
    // Synthetic anchor:* ids route to the aggregated endpoint that
    // unions every child watch (brand keyword + page-id children).
    const url = id.startsWith("anchor:")
      ? `/api/meta/anchor/${encodeURIComponent(id.slice("anchor:".length))}`
      : `/api/meta/${id}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as JobDetail;
    setDetail(j);
    return j;
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!currentId) {
      setDetail(null);
      return;
    }
    void loadDetail(currentId).then((j) => {
      if (!j) return;
      if (j.status === "queued" || j.status === "in_progress") {
        pollRef.current = setInterval(async () => {
          const next = await loadDetail(currentId);
          if (
            next &&
            (next.status === "complete" || next.status === "error")
          ) {
            if (pollRef.current) clearInterval(pollRef.current);
            void loadJobs();
          }
        }, 3000);
      }
    });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [currentId, loadDetail, loadJobs]);

  async function enqueue() {
    const k = keyword.trim();
    if (!k) return;
    setEnqueuing(true);
    try {
      // Heuristic: pure digits ≥ 10 → treat as page_id mode.
      const isPageId = /^\d{10,}$/.test(k);
      const body = isPageId ? { pageId: k } : { keyword: k };
      const res = await fetch("/api/meta/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "enqueue failed");
      await loadJobs();
      setCurrentId(data.id);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setEnqueuing(false);
    }
  }

  async function deleteJob(id: string) {
    if (!confirm("이 메타 수집 작업을 삭제할까?")) return;
    const res = await fetch(`/api/meta/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("삭제 실패");
      return;
    }
    if (currentId === id) setCurrentId(null);
    void loadJobs();
  }

  const isAnchorId = currentId?.startsWith("anchor:") ?? false;
  const anchorName = isAnchorId
    ? currentId!.slice("anchor:".length)
    : null;
  // Synthetic JobSummary so the picker chip can render an anchor row
  // alongside real jobs without special-casing the dropdown UI.
  const currentJob: JobSummary | null = isAnchorId
    ? {
        id: currentId!,
        keyword: anchorName!,
        region: "KR",
        status: detail?.status ?? "complete",
        adCount: detail?.adCount ?? 0,
        pageCount: detail?.pageCount ?? 0,
        errorMsg: null,
        createdAt: new Date().toISOString(),
      }
    : (jobs.find((j) => j.id === currentId) ?? null);

  // Group jobs by their watch's anchorKeyword (= brand). page:* jobs
  // discovered for a brand show up underneath the brand keyword card,
  // so the user sees one row per brand instead of N rows per page.
  const jobGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        anchor: string;
        items: JobSummary[];
        adCount: number;
      }
    >();
    for (const j of jobs) {
      const watch = watchByKeyword.get(j.keyword);
      const anchor = watch?.anchorKeyword || j.keyword;
      const slot = groups.get(anchor) ?? { anchor, items: [], adCount: 0 };
      slot.items.push(j);
      slot.adCount += j.adCount;
      groups.set(anchor, slot);
    }
    return Array.from(groups.values()).sort(
      (a, b) => b.adCount - a.adCount
    );
  }, [jobs, watchByKeyword]);

  return (
    <div className="space-y-4">
      {/* 메인 검색 section — ATC 탭과 동일한 패턴. 드롭다운 안 input 안
          찾아도 바로 검색 가능. 비용 confirm 으로 의도치 않은 메타 수집
          방지 (사이드바 🔄 와 동일). */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <h2 className="mb-2 text-sm font-semibold">메타 광고 라이브러리 불러오기</h2>
        <p className="mb-4 text-xs text-[var(--text-muted)]">
          <b className="text-indigo-700">📘 메타</b>는 한 번 훑는 데 트래픽이 약{" "}
          <b className="text-fuchsia-700">200MB</b> 듭니다 — 프록시를 쓰신다면
          그만큼 깎이니 검색 전에 한 번 물어봅니다. 입력: <b>brand 도메인</b> (예: example.co.kr) ·
          <b> 페이지명</b> (한글) · <b>page_id 숫자</b> (10자리+).
        </p>
        <div className="flex gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const k = keyword.trim();
                if (!k) return;
                if (
                  !confirm(
                    `"${k}" 메타 광고 수집\n\n` +
                      `📊 예상 트래픽: 약 200MB\n` +
                      `프록시를 쓰신다면 그만큼 차감됩니다.\n\n진행할까요?`
                  )
                )
                  return;
                void enqueue();
              }
            }}
            placeholder="예: example.co.kr, example-shop.com, 예시브랜드, 또는 page_id 숫자"
            className="flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
          <button
            onClick={() => {
              const k = keyword.trim();
              if (!k) return;
              if (
                !confirm(
                  `"${k}" 메타 광고 수집\n\n` +
                    `📊 예상 트래픽: 약 200MB\n` +
                    `프록시를 쓰신다면 그만큼 차감됩니다.\n\n진행할까요?`
                )
              )
                return;
              void enqueue();
            }}
            disabled={enqueuing || !keyword.trim()}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enqueuing ? "수집 중..." : "📘 메타 수집"}
          </button>
        </div>
        <div className="mt-2 text-[11px] text-[var(--text-secondary)]">
          💡 숫자만 (10자리+) 입력 → page_id 모드 (광고주 entity 직접 조회 ·
          가장 정확). 그 외 → brand search 모드 (search_terms + page_id 발굴).
        </div>
      </section>

      {/* Single-line toolbar: dropdown selector + new-task button */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">📘 메타 광고</span>

          {/* Job picker dropdown */}
          <div className="relative min-w-[260px] flex-1">
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${
                pickerOpen
                  ? "border-blue-400 bg-blue-500/5"
                  : "border-[var(--border-strong)] bg-[var(--bg-elev)] hover:border-[var(--border)]"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                {currentJob ? (
                  <>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${STATUS_CLASS[currentJob.status]}`}
                    >
                      {STATUS_LABEL[currentJob.status].slice(0, 2)}
                    </span>
                    <span className="truncate font-semibold">
                      {currentJob.keyword.startsWith("page:")
                        ? `📄 page ${currentJob.keyword.slice(5)}`
                        : currentJob.keyword}
                    </span>
                    {currentJob.adCount > 0 && (
                      <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                        광고 {currentJob.adCount}·페이지 {currentJob.pageCount}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-[var(--text-muted)]">
                    {jobs.length === 0
                      ? "아직 수집 기록 없음"
                      : "수집한 브랜드 선택…"}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[var(--text-muted)]">▾</span>
            </button>

            {pickerOpen && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-md border border-[var(--border-strong)] bg-[var(--bg-card)] shadow-2xl">
                {/* Inline new-task input — first row of the dropdown */}
                <div className="border-b border-[var(--border)] p-2">
                  <div className="flex gap-2">
                    <input
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          void enqueue().then(() => setPickerOpen(false));
                        }
                      }}
                      placeholder="새 brand / 페이지명 / page_id 숫자"
                      className="min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-1.5 text-xs outline-none focus:border-blue-400"
                    />
                    <button
                      onClick={() =>
                        void enqueue().then(() => setPickerOpen(false))
                      }
                      disabled={enqueuing || !keyword.trim()}
                      className="shrink-0 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {enqueuing ? "..." : "수집"}
                    </button>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                    숫자만 입력 → page_id 모드 · 그 외 → 브랜드 search 모드
                  </div>
                </div>

                {jobs.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[var(--text-muted)]">
                    아직 수집 기록 없음
                  </div>
                ) : (
                  <div>
                    {jobGroups.map((g) => (
                      <div key={g.anchor}>
                        {/* Brand group header — clickable to load the
                            unified anchor view (deduped across all
                            child jobs). */}
                        <div
                          onClick={() => {
                            setCurrentId(`anchor:${g.anchor}`);
                            setPickerOpen(false);
                          }}
                          className={`flex cursor-pointer items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-elev)]/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide hover:bg-[var(--bg-elev)] ${
                            currentId === `anchor:${g.anchor}`
                              ? "bg-blue-500/10 text-blue-700"
                              : "text-[var(--text-muted)]"
                          }`}
                        >
                          <span>🏷️ {g.anchor}</span>
                          <span className="text-[var(--text-secondary)] normal-case">
                            {g.items.length} entries · {g.adCount} ads
                          </span>
                          <span className="ml-auto rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-bold text-indigo-700">
                            🔗 통합 보기
                          </span>
                        </div>
                        {g.items.map((j) => {
                          const watch = watchByKeyword.get(j.keyword);
                          const source = watch?.source ?? null;
                          const isPage = j.keyword.startsWith("page:");
                          return (
                            <div
                              key={j.id}
                              className={`group flex cursor-pointer items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-xs hover:bg-[var(--bg-elev)] ${
                                j.id === currentId ? "bg-blue-500/10" : ""
                              }`}
                              onClick={() => {
                                setCurrentId(j.id);
                                setPickerOpen(false);
                              }}
                            >
                              <span
                                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${STATUS_CLASS[j.status]}`}
                              >
                                {STATUS_LABEL[j.status].slice(0, 2)}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-semibold">
                                {isPage
                                  ? `📄 ${j.keyword.slice(5).slice(0, 16)}…`
                                  : j.keyword}
                              </span>
                              {source === "auto" && (
                                <span
                                  className="shrink-0 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700"
                                  title="자동 발견된 광고주 entity (stage 1.5)"
                                >
                                  🌱 auto
                                </span>
                              )}
                              {source === "manual" && (
                                <span
                                  className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-700"
                                  title="사용자가 page-id로 수동 등록"
                                >
                                  ✋ manual
                                </span>
                              )}
                              {j.adCount > 0 && (
                                <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                                  {j.adCount}·{j.pageCount}
                                </span>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void deleteJob(j.id);
                                }}
                                className="ml-1 rounded px-1 text-rose-600 opacity-0 hover:bg-rose-500/20 group-hover:opacity-100"
                                title="삭제"
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => void loadJobs()}
            className="shrink-0 rounded border border-[var(--border-strong)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elev)]"
            title="작업 목록 새로고침"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Detail pane */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        {!detail ? (
          <div className="py-16 text-center">
            <div className="mb-2 text-4xl">📘</div>
            <div className="text-sm text-[var(--text-muted)]">
              위 셀렉터에서 브랜드를 고르거나,
              <br />
              새 brand 키워드를 입력해 수집을 시작하세요.
            </div>
            <div className="mx-auto mt-4 max-w-md text-[11px] leading-relaxed text-[var(--text-muted)]">
              🔍 검색어 모드: brand → search_terms + page_id 발굴 + 페이지 단위 재수집
              <br />
              📄 page_id 모드: 숫자만 → 광고주 entity 직접 조회
            </div>
          </div>
        ) : (
          <DetailPane
            detail={detail}
            reloadDetail={async () => {
              if (currentId) await loadDetail(currentId);
            }}
          />
        )}
      </section>
    </div>
  );
}

type DetailTab = "ads" | "pages";
type Density = "compact" | "comfy";
type TierFilter = "all" | "A" | "AB";
type SortMode = "tier" | "recent" | "longRun";

// === A-tier scoring (per user's calibration) ===
// Active signals (1, 3, 5, 9). Display order intentionally NOT used
// — user verified across 20 brands that order ↔ spend correlation is
// only ~50%, so it adds noise.
function daysBetween(start: string | null, stop: string | null): number {
  if (!start) return 0;
  // Meta returns dates in two shapes: "2026. 5. 3." (KR locale) and
  // ISO. Try both.
  const parse = (s: string): number => {
    const t = Date.parse(s);
    if (!isNaN(t)) return t;
    const m = s.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (m)
      return Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3])
      );
    return NaN;
  };
  const s = parse(start);
  const e = stop ? parse(stop) : Date.now();
  if (isNaN(s) || isNaN(e)) return 0;
  return Math.max(0, (e - s) / (1000 * 60 * 60 * 24));
}

function scoreAd(
  ad: MetaAd & ScoringExtras
): {
  score: number;
  days: number;
  isActive: boolean;
  variants: number;
  variantsSource: "meta" | "heuristic";
  ytViews: number;
} {
  const days = daysBetween(ad.startTime, ad.stopTime);
  const isActive = !ad.stopTime;
  // Prefer Meta's own "광고 N개에서..." count when we've enriched it
  // — that's the ground truth. Fall back to the body-hash heuristic
  // only when enrichment hasn't run yet for this ad.
  const useMeta = (ad.metaVariantCount ?? null) !== null;
  const variants = Math.max(
    1,
    useMeta ? (ad.metaVariantCount as number) : (ad.variantCount ?? 1)
  );
  const variantsSource: "meta" | "heuristic" = useMeta ? "meta" : "heuristic";
  const ytViews = ad.ytTopViews ?? 0;

  // Composite signals (1·3·5·9). Engagement (#6) intentionally absent
  // because Meta doesn't expose reactions for KR commercial ads — we
  // upgraded that signal to the more accurate metaVariantCount instead.
  // metaVariantCount weight is bumped (1.0 vs heuristic 0.7) since
  // it's exact rather than estimated.
  const variantWeight = useMeta ? 1.0 : 0.7;
  const score =
    Math.log10(days + 1) * 1.5 +
    (isActive ? 2.0 : 0) +
    (variants - 1) * variantWeight +
    (ytViews > 0 ? Math.log10(ytViews + 1) * 0.6 : 0);

  return { score, days, isActive, variants, variantsSource, ytViews };
}

// Percentile-based tier within the brand: top 20% = A, next 30% = B,
// rest = C. Computed per-anchor so tiers are RELATIVE — even a small
// brand with mediocre ads gets a clear ranking.
function tierAds<T extends MetaAd & ScoringExtras>(
  ads: T[]
): Map<string, "A" | "B" | "C"> {
  if (ads.length === 0) return new Map();
  const scored = ads
    .map((a) => ({ id: a.adArchiveId, score: scoreAd(a).score }))
    .sort((x, y) => y.score - x.score);
  const aCut = Math.max(1, Math.ceil(scored.length * 0.2));
  const bCut = Math.max(aCut + 1, Math.ceil(scored.length * 0.5));
  const m = new Map<string, "A" | "B" | "C">();
  scored.forEach((s, i) => {
    m.set(s.id, i < aCut ? "A" : i < bCut ? "B" : "C");
  });
  return m;
}

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Heuristic: does this string look like a sock-puppet / unicode-laundered
// page name that almost certainly isn't the real brand? Catches "Iiiilililliii",
// "Chorki", "Novel reading", "Alpha Capital Group", non-Korean drama farms.
function looksSuspicious(s: string): boolean {
  if (!s) return false;
  if (/[lI1|]{4,}/.test(s)) return true; // i+l obfuscation
  if (/[぀-ヿͰ-ϿЀ-ӿ\u{1F100}-\u{1FFFF}]/u.test(s)) return true; // mixed scripts
  if (/\b(novel|reading|drama|memes|capital|chorki)\b/i.test(s)) return true;
  return false;
}

// Brand-stem extraction: "example.co.kr" → "alphai", "예시브랜드" → "예시브랜드".
// Used to score whether an ad's pageName / lpDomain actually matches the
// brand it was supposedly scraped under.
function brandStem(s: string): string {
  return s
    .replace(/^page:/, "")
    .replace(/\.(co\.kr|kr|com|net|io)$/i, "")
    .replace(/[^a-z0-9가-힣]/gi, "")
    .toLowerCase();
}
function adMatchesBrand(
  ad: { pageName: string; lpDomain?: string | null },
  stem: string
): boolean {
  if (!stem) return true;
  const hay = `${ad.pageName ?? ""} ${ad.lpDomain ?? ""}`.toLowerCase();
  return hay.includes(stem);
}

function DetailPane({
  detail,
  reloadDetail,
}: {
  detail: JobDetail;
  reloadDetail: () => Promise<void>;
}) {
  const inProgress =
    detail.status === "queued" || detail.status === "in_progress";
  const [tab, setTab] = useState<DetailTab>("ads");
  const [density, setDensity] = useState<Density>("compact");
  // Default ON. Meta full-text search returns a lot of sock-puppet
  // matches whose pageName / lpDomain don't share any character with
  // the brand keyword (example.co.kr → "Sample Page Name", "BRAND-C.COM").
  // Showing those by default trains the user to distrust the table.
  // The toggles let them flip filters off if they want to audit raw.
  const [brandOnly, setBrandOnly] = useState(true);
  const [hideSuspicious, setHideSuspicious] = useState(true);
  const [purging, setPurging] = useState(false);
  const [enriching, setEnriching] = useState(false);

  // Auto-poll while engagement enrichment is running so the user sees
  // the progress counter advance + the new likeCount values populate
  // the table without manual refresh.
  useEffect(() => {
    if (detail.enrichment?.status !== "running") return;
    const t = setInterval(() => {
      void reloadDetail();
    }, 2500);
    return () => clearInterval(t);
  }, [detail.enrichment?.status, reloadDetail]);
  // A-tier sort + filter — defaults to score-sorted descending so the
  // user's eye lands on hero creatives first.
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("tier");

  // Group ads by their running page so the "페이지" tab can show
  // sock-puppet vs official-page distribution at a glance.
  const pages = useMemo(() => {
    const m = new Map<
      string,
      { pageName: string; pageId: string; ads: MetaAd[] }
    >();
    for (const ad of detail.ads ?? []) {
      const key = ad.pageId || ad.pageName || "(unknown)";
      const slot = m.get(key) ?? {
        pageName: ad.pageName || "(no name)",
        pageId: ad.pageId || "",
        ads: [],
      };
      slot.ads.push(ad);
      m.set(key, slot);
    }
    return Array.from(m.values()).sort((a, b) => b.ads.length - a.ads.length);
  }, [detail.ads]);

  const isPageMode = detail.keyword.startsWith("page:");

  // Filter pipeline: brandOnly + hideSuspicious drop ads that don't
  // belong to the real brand. Filters layer — empty filters = identity.
  const stem = brandStem(detail.keyword);
  const baseFiltered = useMemo(() => {
    let xs = detail.ads ?? [];
    if (brandOnly) xs = xs.filter((a) => adMatchesBrand(a, stem));
    if (hideSuspicious) xs = xs.filter((a) => !looksSuspicious(a.pageName));
    return xs;
  }, [detail.ads, brandOnly, hideSuspicious, stem]);

  // Tier classification + tier filter + sort — applied AFTER brand
  // filters so the percentile cuts are computed on the clean set.
  const tierMap = useMemo(() => tierAds(baseFiltered), [baseFiltered]);
  const filteredAds = useMemo(() => {
    let xs = baseFiltered;
    if (tierFilter === "A") {
      xs = xs.filter((a) => tierMap.get(a.adArchiveId) === "A");
    } else if (tierFilter === "AB") {
      xs = xs.filter((a) => {
        const t = tierMap.get(a.adArchiveId);
        return t === "A" || t === "B";
      });
    }
    const withScore = xs.map((a) => ({ ad: a, score: scoreAd(a) }));
    if (sortMode === "tier") {
      withScore.sort((x, y) => y.score.score - x.score.score);
    } else if (sortMode === "longRun") {
      withScore.sort((x, y) => y.score.days - x.score.days);
    } else {
      // recent
      withScore.sort(
        (x, y) =>
          new Date(y.ad.savedAt).getTime() -
          new Date(x.ad.savedAt).getTime()
      );
    }
    return withScore.map((w) => w.ad);
  }, [baseFiltered, tierMap, tierFilter, sortMode]);
  const adsCount = filteredAds.length;
  const totalAds = detail.ads?.length ?? 0;
  const droppedCount = totalAds - baseFiltered.length;
  const tierCounts = useMemo(() => {
    const c = { A: 0, B: 0, C: 0 };
    for (const t of tierMap.values()) c[t]++;
    return c;
  }, [tierMap]);

  return (
    <div>
      {/* Brand header */}
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold">
          {detail.isAggregate
            ? `🔗 ${detail.keyword}`
            : isPageMode
              ? `📄 page_id ${detail.keyword.slice(5)}`
              : detail.keyword}
        </h3>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_CLASS[detail.status]}`}
        >
          {STATUS_LABEL[detail.status]}
        </span>
        {detail.isAggregate && (
          <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
            통합 보기 · {detail.childKeywords?.length ?? 0}개 키워드
          </span>
        )}
        <span className="ml-auto text-[11px] text-[var(--text-muted)]">
          region={detail.region}
        </span>
      </div>

      {/* Aggregate child breakdown — shows how the unified ad-count
          rolls up from each watch (brand keyword + page-id children).
          Only rendered for /api/meta/anchor/:anchor responses. */}
      {detail.isAggregate &&
        (detail.childWatches?.length ?? 0) > 0 && (
          <div className="mt-3 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-indigo-700">
              <span>
                🔗 통합한 키워드 ({detail.childWatches!.length}개) — 광고{" "}
                {detail.adCount}개 (중복 제거)
              </span>
              {/* Brand-level Meta activity total — shown when at least
                  one child watch has been enriched. */}
              {(detail.metaResultCountTotal ?? 0) > 0 && (
                <span
                  className="rounded-full bg-amber-500/15 px-2 py-1 text-amber-700"
                  title='메타 검색 결과 페이지의 "결과 ~N개" 합산. 브랜드의 실제 메타 광고 활동량 (중복 제거 전).'
                >
                  📊 메타 활동량 {detail.metaResultCountTotal}개
                </span>
              )}
              {/* Phase-2 library-signals enrichment trigger + progress */}
              {(() => {
                const enr = detail.enrichment;
                const unenrichedCount = (detail.ads ?? []).filter(
                  (a) => !a.librarySignalsFetchedAt
                ).length;
                const totalCount = detail.ads?.length ?? 0;
                if (enr && enr.status === "running") {
                  const pct = enr.total
                    ? Math.round((enr.done / enr.total) * 100)
                    : 0;
                  return (
                    <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-blue-500/20 px-3 py-1 text-blue-700">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                      📊 메타 신호 수집 중 {enr.done}/{enr.total} ({pct}%)
                    </span>
                  );
                }
                if (unenrichedCount > 0) {
                  return (
                    <button
                      onClick={async () => {
                        if (
                          !confirm(
                            `${unenrichedCount}개 광고에 대해 Meta가 직접 표시하는 변형 카운트("광고 N개에서...")와 브랜드 활동량("결과 ~N개")을 수집할까요?\n\n각 광고당 ~6-8초, 총 ${Math.ceil((unenrichedCount * 7) / 60)}분 예상`
                          )
                        )
                          return;
                        setEnriching(true);
                        try {
                          const r = await fetch(
                            `/api/meta/anchor/${encodeURIComponent(detail.keyword)}`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                action: "enrich-library-signals",
                              }),
                            }
                          );
                          const d = await r.json();
                          if (!r.ok)
                            throw new Error(d.error || "enrichment failed");
                          await reloadDetail();
                        } catch (e) {
                          alert((e as Error).message);
                        } finally {
                          setEnriching(false);
                        }
                      }}
                      disabled={enriching}
                      className="ml-auto rounded-full border border-indigo-500/60 bg-indigo-500/15 px-3 py-1 font-bold text-indigo-700 hover:bg-indigo-500/30 disabled:opacity-50"
                      title='Meta 라이브러리 페이지에서 정확한 변형 카운트 + 브랜드 활동량 스크랩'
                    >
                      📊 메타 신호 수집 ({unenrichedCount}개)
                    </button>
                  );
                }
                if (totalCount > 0) {
                  return (
                    <span className="ml-auto rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-700">
                      ✅ 모든 광고 메타 신호 수집 완료
                    </span>
                  );
                }
                return null;
              })()}
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {detail.childWatches!.map((c) => (
                <div
                  key={c.keyword}
                  className="flex items-center justify-between gap-2 rounded border border-[var(--border)] bg-[var(--bg-elev)] px-2 py-1.5 text-[11px]"
                >
                  <span className="flex min-w-0 items-center gap-1">
                    {c.source === "auto" && (
                      <span title="auto-discovered" className="text-emerald-600">
                        🌱
                      </span>
                    )}
                    {c.source === "manual" && (
                      <span title="user-pinned" className="text-amber-600">
                        ✋
                      </span>
                    )}
                    {c.source === "seed" && (
                      <span title="brand keyword seed">🏷️</span>
                    )}
                    <span className="truncate font-medium">
                      {c.keyword.startsWith("page:")
                        ? `page ${c.keyword.slice(5).slice(0, 12)}…`
                        : c.keyword}
                    </span>
                  </span>
                  <span className="shrink-0 font-bold text-[var(--text-primary)]">
                    {c.adCount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      {/* Phase-3b: cross-platform ATC reference card.
          Surfaces YouTube ads from our ATC index that share this brand
          name, so the user can sanity-check Meta scoring against the
          ground-truth view counts on the Google side. */}
      {detail.isAggregate &&
        (detail.atcBrandSummary?.totalVideos ?? 0) > 0 && (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-rose-700">
              <span>
                ▶ ATC YouTube 광고 ({detail.atcBrandSummary!.totalVideos}개)
              </span>
              <span className="text-[var(--text-muted)]">
                · 누적 조회 {fmtViews(detail.atcBrandSummary!.totalViews)}
              </span>
              <span className="ml-auto text-[10px] font-normal text-[var(--text-muted)]">
                같은 브랜드의 구글 광고 영상 (advertiserName 매칭)
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
              {detail.atcBrandSummary!.top5.map((v, idx) => (
                <a
                  key={`${v.youtubeId ?? "noid"}-${idx}`}
                  href={
                    v.youtubeId
                      ? `https://www.youtube.com/watch?v=${v.youtubeId}`
                      : "#"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-[var(--border)] bg-[var(--bg-elev)] p-2 text-[10px] hover:border-rose-500/50"
                  title={`${v.title}\n${v.channel}\n${fmtViews(v.views)}회`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-rose-700">
                      ▶ {fmtViews(v.views)}
                    </span>
                    <span className="text-[var(--text-muted)]">
                      {v.channel?.slice(0, 12) ?? ""}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 leading-snug text-[var(--text-secondary)]">
                    {v.title || "(제목 없음)"}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

      {/* Tabs + filter toolbar */}
      {!inProgress && (detail.ads?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)]">
          <div className="flex items-center gap-1">
            <TabButton
              active={tab === "ads"}
              onClick={() => setTab("ads")}
              icon="📋"
              label="광고"
              count={adsCount}
            />
            <TabButton
              active={tab === "pages"}
              onClick={() => setTab("pages")}
              icon="🏷️"
              label="페이지"
              count={pages.length}
            />
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5 pb-1.5 text-[10px]">
            {/* A-tier filter pills — counts come from the live brand-
                filtered set so the user sees how many heroes survive
                their other toggles. */}
            <div className="flex items-center gap-0.5 rounded-full border border-[var(--border)] p-0.5">
              <button
                onClick={() => setTierFilter("all")}
                className={`rounded-full px-2 py-0.5 font-bold transition ${
                  tierFilter === "all"
                    ? "bg-[var(--bg-elev)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                전체 {baseFiltered.length}
              </button>
              <button
                onClick={() => setTierFilter("A")}
                className={`rounded-full px-2 py-0.5 font-bold transition ${
                  tierFilter === "A"
                    ? "bg-amber-500/30 text-amber-200"
                    : "text-amber-600 hover:bg-amber-500/10"
                }`}
                title="상위 20% — 게재 기간 + 변형 수 + active + 구글 매칭 합산"
              >
                🥇 A {tierCounts.A}
              </button>
              <button
                onClick={() => setTierFilter("AB")}
                className={`rounded-full px-2 py-0.5 font-bold transition ${
                  tierFilter === "AB"
                    ? "bg-slate-500/30 text-slate-200"
                    : "text-slate-700 hover:bg-slate-500/10"
                }`}
                title="상위 50%"
              >
                🥈 A+B {tierCounts.A + tierCounts.B}
              </button>
            </div>
            {/* Sort selector */}
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-2 py-1 font-bold text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
              title="정렬 기준"
            >
              <option value="tier">A급 점수 순</option>
              <option value="longRun">게재 기간 순</option>
              <option value="recent">최근 수집 순</option>
            </select>
            <div className="mx-1 h-3 w-px bg-[var(--border)]" />
            <button
              onClick={() => setBrandOnly((v) => !v)}
              className={`rounded-full border px-2 py-1 font-bold transition ${
                brandOnly
                  ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-700"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
              }`}
              title={`pageName / lpDomain에 "${stem}" 들어간 광고만`}
            >
              {brandOnly ? "✓ " : ""}브랜드만
            </button>
            <button
              onClick={() => setHideSuspicious((v) => !v)}
              className={`rounded-full border px-2 py-1 font-bold transition ${
                hideSuspicious
                  ? "border-rose-500/60 bg-rose-500/15 text-rose-700"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
              }`}
              title="유니코드 위장 / novel·drama·capital sock-puppet 페이지 광고 숨기기"
            >
              {hideSuspicious ? "✓ " : ""}🐤 위장 숨기기
            </button>
            <div className="mx-1 h-3 w-px bg-[var(--border)]" />
            <button
              onClick={() =>
                setDensity(density === "compact" ? "comfy" : "compact")
              }
              className="rounded-full border border-[var(--border)] px-2 py-1 font-bold text-[var(--text-muted)] hover:border-[var(--border-strong)]"
              title="카드 크기 전환"
            >
              {density === "compact" ? "🔍 크게" : "🗂️ 조밀"}
            </button>
            {droppedCount > 0 && (
              <span className="text-[var(--text-muted)]">
                {droppedCount}개 제외됨
              </span>
            )}
            {/* Permanent purge — only meaningful for anchor view, where
                we know the brand stem to check against. */}
            {detail.isAggregate && droppedCount > 0 && (
              <button
                onClick={async () => {
                  if (
                    !confirm(
                      `"${detail.keyword}" 브랜드에서 무관/위장 광고 ${droppedCount}개를 DB에서 영구 삭제할까요?\n\n(브랜드만 / 위장 숨기기 토글로 가려진 광고들이 대상)`
                    )
                  )
                    return;
                  setPurging(true);
                  try {
                    const r = await fetch(
                      `/api/meta/anchor/${encodeURIComponent(detail.keyword)}`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "purge-noise" }),
                      }
                    );
                    const d = await r.json();
                    if (!r.ok)
                      throw new Error(d.error || "purge failed");
                    alert(
                      `삭제됨: ${d.deleted}개\n남은 광고: ${d.surviving}개`
                    );
                    location.reload();
                  } catch (e) {
                    alert((e as Error).message);
                  } finally {
                    setPurging(false);
                  }
                }}
                disabled={purging}
                className="rounded-full border border-rose-500/60 bg-rose-500/15 px-2 py-1 font-bold text-rose-700 hover:bg-rose-500/30 disabled:opacity-50"
                title="제외된 광고를 DB에서 영구 삭제"
              >
                🗑️ {droppedCount}개 영구삭제
              </button>
            )}
          </div>
        </div>
      )}

      {inProgress && (
        <MetaLiveProgress
          status={detail.status}
          logs={detail.logs}
        />
      )}

      {detail.status === "error" && (
        <div className="my-6 rounded-md border border-rose-500/40 bg-rose-500/5 px-4 py-3 text-sm text-rose-700">
          <div className="font-bold">❌ 실패</div>
          <div className="mt-1 break-words text-xs">{detail.errorMsg}</div>
        </div>
      )}

      {detail.logs.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
            ▸ logs ({detail.logs.length})
          </summary>
          <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--bg-elev)] p-3 font-mono text-[10px] leading-snug text-[var(--text-secondary)]">
            {detail.logs.slice(-30).map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </details>
      )}

      {/* Ads view — compact = ATC-style table rows; comfy = card grid */}
      {!inProgress &&
        tab === "ads" &&
        filteredAds.length > 0 &&
        density === "compact" && (
          <AdTable
            ads={filteredAds}
            stem={stem}
            isSuspicious={looksSuspicious}
            isOffBrand={(a) => !adMatchesBrand(a, stem)}
            tierMap={tierMap}
          />
        )}
      {!inProgress &&
        tab === "ads" &&
        filteredAds.length > 0 &&
        density === "comfy" && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredAds.map((ad) => (
              <AdCard
                key={ad.adArchiveId}
                ad={ad}
                density="comfy"
                suspicious={looksSuspicious(ad.pageName)}
                offBrand={!adMatchesBrand(ad, stem)}
              />
            ))}
          </div>
        )}
      {!inProgress &&
        tab === "ads" &&
        filteredAds.length === 0 &&
        totalAds > 0 && (
          <div className="my-10 rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--bg-elev)] py-8 text-center text-xs text-[var(--text-muted)]">
            필터로 모든 광고가 제외됨 — 토글을 풀어보세요.
          </div>
        )}

      {!inProgress && tab === "pages" && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {pages.map((p) => (
            <PageCard key={p.pageId || p.pageName} group={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition ${
        active
          ? "border-blue-400 text-[var(--text-primary)]"
          : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
          active
            ? "bg-blue-500/20 text-blue-700"
            : "bg-[var(--bg-elev)] text-[var(--text-muted)]"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * Table-row layout — same shape as the ATC `광고 수집` tab so scanning
 * across both views feels consistent. Small fixed thumbnail on the
 * left, body excerpt + page metadata in the middle, structured columns
 * on the right (게시일 / 유형 / 플랫폼 / LP).
 */
function AdTable({
  ads,
  isSuspicious,
  isOffBrand,
  tierMap,
}: {
  ads: (MetaAd & { sourceKeyword?: string } & ScoringExtras)[];
  stem: string;
  isSuspicious: (name: string) => boolean;
  isOffBrand: (ad: MetaAd) => boolean;
  tierMap: Map<string, "A" | "B" | "C">;
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full min-w-[1000px] border-collapse text-xs">
        <thead className="bg-[var(--bg-elev)] text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          <tr>
            <th className="w-10 px-2 py-2 text-left">#</th>
            <th className="w-14 px-2 py-2 text-center" title="A급 점수 (게재기간+변형+active+구글매칭)">
              등급
            </th>
            <th className="w-[88px] px-2 py-2 text-left">썸네일</th>
            <th className="px-2 py-2 text-left">제목 / 페이지 / 본문</th>
            <th className="w-24 px-2 py-2 text-center">광고</th>
            <th className="w-20 px-2 py-2 text-center">유형</th>
            <th className="w-28 px-2 py-2 text-center">플랫폼</th>
            <th className="w-24 px-2 py-2 text-center" title="시작일 → 종료일까지의 게재 기간">
              게시일 / 일수
            </th>
            <th
              className="w-20 px-2 py-2 text-center"
              title='Meta가 직접 표시하는 "광고 N개에서 이 크리에이티브 사용" 카운트. 브랜드가 위너를 굴리고 있다는 가장 강한 신호.'
            >
              🔁 변형 (Meta)
            </th>
            <th className="w-32 px-2 py-2 text-left">LP / UTM</th>
            <th className="w-12 px-2 py-2 text-center">상태</th>
          </tr>
        </thead>
        <tbody>
          {ads.map((ad, i) => {
            const susp = isSuspicious(ad.pageName);
            const off = isOffBrand(ad);
            const body = ad.bodies[0] || ad.linkTitles[0] || "";
            const title = ad.linkTitles[0] || "";
            const start = ad.startTime?.slice(0, 10);
            const isActive = !ad.stopTime;
            const tier = tierMap.get(ad.adArchiveId) ?? "C";
            const sc = scoreAd(ad);
            return (
              <tr
                key={ad.adArchiveId}
                className={`border-t border-[var(--border)] align-top hover:bg-[var(--bg-elev)]/40 ${
                  susp || off ? "bg-rose-500/5" : ""
                }`}
              >
                <td className="px-2 py-2 font-mono text-[10px] text-[var(--text-muted)]">
                  {i + 1}
                </td>
                {/* Tier badge — A/B/C derived from composite score.
                    Hover for the breakdown that drove this rank. */}
                <td className="px-2 py-2 text-center">
                  <span
                    className={`inline-flex items-center justify-center rounded-md px-1.5 py-1 text-[10px] font-bold ${
                      tier === "A"
                        ? "bg-amber-500/20 text-amber-700 ring-1 ring-amber-500/40"
                        : tier === "B"
                          ? "bg-slate-500/20 text-slate-200"
                          : "bg-slate-700/40 text-slate-500"
                    }`}
                    title={`${tier}급 · 점수 ${sc.score.toFixed(1)}\n게재 ${Math.round(sc.days)}일${
                      sc.isActive ? " (active)" : ""
                    }\n변형 ${sc.variants}개${
                      sc.ytViews ? `\nATC YouTube ${fmtViews(sc.ytViews)} 조회` : ""
                    }`}
                  >
                    {tier === "A" ? "🥇" : tier === "B" ? "🥈" : "🥉"} {tier}
                  </span>
                  <div className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)]">
                    {sc.score.toFixed(1)}
                  </div>
                </td>
                {/* Thumbnail — fixed 72×72 square so density stays uniform */}
                <td className="px-2 py-2">
                  <a
                    href={metaLibraryLink(ad.adArchiveId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative block h-[72px] w-[72px] overflow-hidden rounded-md bg-[var(--bg-elev)]"
                    title="라이브러리에서 열기"
                  >
                    {ad.mediaUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={ad.mediaUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--text-muted)]">
                        —
                      </div>
                    )}
                    {ad.mediaType === "video" && (
                      <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] font-bold text-white">
                        ▶
                      </span>
                    )}
                  </a>
                </td>
                {/* Title / page / body */}
                <td className="px-2 py-2">
                  {title && (
                    <div
                      className="line-clamp-1 text-[12px] font-semibold text-[var(--text-primary)]"
                      title={title}
                    >
                      {title}
                    </div>
                  )}
                  <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                    <span>광고주: </span>
                    <a
                      href={
                        ad.pageId
                          ? `https://www.facebook.com/${ad.pageId}`
                          : "#"
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-[var(--text-secondary)] hover:text-blue-700 hover:underline"
                      title={ad.pageName}
                    >
                      {ad.pageName || "(unknown)"}
                    </a>
                    {susp && (
                      <span
                        className="ml-1.5 rounded-full bg-rose-500/20 px-1 py-0.5 font-bold text-rose-700"
                        title="유니코드 위장 / sock-puppet 의심"
                      >
                        🐤
                      </span>
                    )}
                    {off && !susp && (
                      <span
                        className="ml-1.5 rounded-full bg-rose-500/20 px-1 py-0.5 font-bold text-rose-700"
                        title="브랜드 키워드와 무관한 페이지"
                      >
                        ≠ 무관
                      </span>
                    )}
                    {ad.sourceKeyword && (
                      <span className="ml-1.5 text-[var(--text-muted)]">
                        ·{" "}
                        {ad.sourceKeyword.startsWith("page:")
                          ? `page ${ad.sourceKeyword.slice(5).slice(0, 8)}…`
                          : ad.sourceKeyword}
                      </span>
                    )}
                  </div>
                  {/* Score-input badges: variant fan-out + YT cross-link.
                      Both directly drive the A-tier score so seeing them
                      next to the body text makes the rank legible. */}
                  {(sc.variants > 1 || (ad.ytTopViews ?? 0) > 0) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                      {sc.variants > 1 && (
                        <span
                          className={`rounded px-1.5 py-0.5 font-bold ${
                            sc.variantsSource === "meta"
                              ? "bg-emerald-500/20 text-emerald-700"
                              : "bg-indigo-500/20 text-indigo-700"
                          }`}
                          title={
                            sc.variantsSource === "meta"
                              ? `Meta가 직접 표시: "광고 ${sc.variants}개에서 이 크리에이티브 사용"`
                              : "추정값 (body 해시 기반). 메타 신호 수집하면 정확해짐."
                          }
                        >
                          🔁 변형 {sc.variants}
                          {sc.variantsSource === "meta" && (
                            <span className="ml-1 opacity-70">·Meta</span>
                          )}
                        </span>
                      )}
                      {ad.ytMatches && ad.ytMatches.length > 0 && (
                        <span
                          className="rounded bg-rose-500/20 px-1.5 py-0.5 font-bold text-rose-700"
                          title={ad.ytMatches
                            .map(
                              (m) =>
                                `${m.youtubeId}: ${
                                  m.ytViews
                                    ? fmtViews(m.ytViews) + "회"
                                    : "조회수 없음"
                                }${m.ytTitle ? ` — ${m.ytTitle}` : ""}`
                            )
                            .join("\n")}
                        >
                          ▶ ATC {fmtViews(ad.ytTopViews ?? 0)}회
                        </span>
                      )}
                      {/* Phase-3a: BIT.LY-resolved YouTube id without an
                          ATC match yet. Still useful — tells the user
                          "this ad lands on YouTube" even if we haven't
                          indexed the video. */}
                      {ad.resolvedYoutubeId &&
                        (!ad.ytMatches || ad.ytMatches.length === 0) && (
                          <a
                            href={`https://www.youtube.com/watch?v=${ad.resolvedYoutubeId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded bg-rose-500/10 px-1.5 py-0.5 font-bold text-rose-700/70 hover:bg-rose-500/20"
                            title={`BIT.LY 따라가니 YouTube 영상: ${ad.resolvedYoutubeId}\n(ATC DB에 색인 안 됨 — 수동 추가하면 조회수 매칭됨)`}
                          >
                            ▶ YT (미색인)
                          </a>
                        )}
                      {/* Resolved final domain — for non-YT BIT.LY chains
                          that lead to a real product/brand site. */}
                      {ad.resolvedLpDomain &&
                        ad.resolvedLpDomain !== ad.lpDomain && (
                          <span
                            className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-emerald-700"
                            title={`BIT.LY 최종 도착지: ${ad.resolvedLpUrl}`}
                          >
                            → {ad.resolvedLpDomain}
                          </span>
                        )}
                    </div>
                  )}
                  {body && (
                    <div
                      className="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--text-secondary)]"
                      title={body}
                    >
                      📝 {body}
                    </div>
                  )}
                </td>
                {/* Library link button */}
                <td className="px-2 py-2 text-center">
                  <a
                    href={metaLibraryLink(ad.adArchiveId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-500/30"
                  >
                    ▶ 보기
                  </a>
                </td>
                {/* Type tag */}
                <td className="px-2 py-2 text-center">
                  {ad.mediaType ? (
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        ad.mediaType === "video"
                          ? "bg-rose-500/20 text-rose-700"
                          : "bg-slate-500/20 text-slate-700"
                      }`}
                    >
                      {ad.mediaType === "video" ? "🎬 영상" : "🖼️ 이미지"}
                    </span>
                  ) : (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                </td>
                {/* Platforms */}
                <td className="px-2 py-2 text-center">
                  <div className="flex flex-wrap items-center justify-center gap-0.5">
                    {ad.publisherPlatforms.length > 0 ? (
                      ad.publisherPlatforms
                        .slice(0, 3)
                        .map(platformBadge)
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                    {ad.publisherPlatforms.length > 3 && (
                      <span className="text-[9px] text-[var(--text-muted)]">
                        +{ad.publisherPlatforms.length - 3}
                      </span>
                    )}
                  </div>
                </td>
                {/* Start date + computed run length (key A-tier signal) */}
                <td className="whitespace-nowrap px-2 py-2 text-center font-mono text-[10px] text-[var(--text-secondary)]">
                  {start ?? "—"}
                  <div
                    className={`mt-0.5 text-[10px] font-bold ${
                      sc.days >= 30
                        ? "text-emerald-700"
                        : sc.days >= 14
                          ? "text-amber-700"
                          : "text-[var(--text-muted)]"
                    }`}
                    title={
                      isActive
                        ? "현재 게재 중 — 종료 시점까지 일수 누적"
                        : "종료된 광고"
                    }
                  >
                    {Math.round(sc.days)}일
                    {isActive && "+"}
                  </div>
                </td>
                {/* Variant count — Meta's exact figure when enriched,
                    falls back to body-hash heuristic. Source pill makes
                    confidence legible. */}
                <td className="px-2 py-2 text-center text-[10px]">
                  {ad.librarySignalsFetchedAt == null ? (
                    <div
                      className="flex flex-col items-center gap-0.5"
                      title={`추정값 (body 해시 기반). 메타 신호 수집하면 정확한 카운트로 갱신.`}
                    >
                      <span
                        className={`font-bold ${
                          sc.variants > 1
                            ? "text-indigo-700"
                            : "text-[var(--text-muted)]"
                        }`}
                      >
                        🔁 {sc.variants}
                      </span>
                      <span className="text-[9px] text-[var(--text-muted)]">
                        추정
                      </span>
                    </div>
                  ) : (
                    <div
                      className="flex flex-col items-center gap-0.5"
                      title={`Meta가 직접 표시한 카운트 — "광고 ${ad.metaVariantCount}개에서 이 크리에이티브 사용"`}
                    >
                      <span
                        className={`font-bold ${
                          (ad.metaVariantCount ?? 1) > 1
                            ? "text-emerald-700"
                            : "text-[var(--text-muted)]"
                        }`}
                      >
                        🔁 {ad.metaVariantCount ?? 1}
                      </span>
                      <span className="rounded bg-emerald-500/10 px-1 text-[9px] font-bold text-emerald-700">
                        Meta
                      </span>
                    </div>
                  )}
                </td>
                {/* LP / UTM */}
                <td className="px-2 py-2">
                  {ad.lpDomain ? (
                    <a
                      href={ad.lpUrl ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={ad.lpUrl ?? undefined}
                      className="block truncate font-mono text-[10px] uppercase text-emerald-600 hover:underline"
                    >
                      {ad.lpDomain}
                    </a>
                  ) : (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                  {ad.utmCampaign && (
                    <div
                      className="mt-0.5 truncate font-mono text-[10px] text-amber-700/80"
                      title={ad.utmCampaign}
                    >
                      {ad.utmCampaign}
                    </div>
                  )}
                </td>
                {/* Active status pill */}
                <td className="px-2 py-2 text-center">
                  <span
                    className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      isActive
                        ? "bg-emerald-500/20 text-emerald-700"
                        : "bg-slate-500/20 text-slate-700"
                    }`}
                    title={isActive ? "현재 게재중" : "종료됨"}
                  >
                    {isActive ? "●" : "○"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Square media + page header + body + lp/UTM footer — mirrors Meta's
 * own Ad Library card layout to make scanning feel familiar.
 */
function AdCard({
  ad,
  density = "comfy",
  suspicious = false,
  offBrand = false,
}: {
  ad: MetaAd & { sourceKeyword?: string };
  density?: Density;
  suspicious?: boolean;
  offBrand?: boolean;
}) {
  const body = ad.bodies[0] || ad.linkTitles[0] || "";
  const desc = ad.linkDescriptions[0] ?? "";
  const start = ad.startTime?.slice(0, 10);
  const stop = ad.stopTime?.slice(0, 10);
  const isActive = !ad.stopTime;
  const compact = density === "compact";

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border bg-[var(--bg-elev)] shadow-sm transition hover:border-[var(--border-strong)] ${
        suspicious || offBrand
          ? "border-rose-500/30 ring-1 ring-rose-500/10"
          : "border-[var(--border)]"
      }`}
    >
      {/* Page header — denser in compact mode */}
      <div
        className={`flex items-center gap-2 border-b border-[var(--border)] ${
          compact ? "px-2 py-1.5" : "px-3 py-2"
        }`}
      >
        {ad.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.avatarUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className={`shrink-0 rounded-full bg-slate-700 object-cover ${
              compact ? "h-6 w-6" : "h-8 w-8"
            }`}
          />
        ) : (
          <div
            className={`shrink-0 rounded-full bg-slate-700 ${
              compact ? "h-6 w-6" : "h-8 w-8"
            }`}
          />
        )}
        <div className="min-w-0 flex-1">
          <a
            href={
              ad.pageId
                ? `https://www.facebook.com/${ad.pageId}`
                : "#"
            }
            target="_blank"
            rel="noopener noreferrer"
            className={`block truncate font-bold text-[var(--text-primary)] hover:text-blue-700 hover:underline ${
              compact ? "text-[11px]" : "text-xs"
            }`}
            title={ad.pageName || "(no page name)"}
          >
            {ad.pageName || "(no page name)"}
          </a>
          {!compact && (
            <div className="text-[10px] text-[var(--text-muted)]">광고</div>
          )}
        </div>
        {!compact && (
          <div className="flex shrink-0 items-center gap-1">
            {ad.publisherPlatforms.map(platformBadge)}
          </div>
        )}
        {(suspicious || offBrand) && (
          <span
            className="shrink-0 rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-bold text-rose-700"
            title={
              suspicious
                ? "유니코드 위장 / sock-puppet 의심"
                : "브랜드 키워드와 무관한 페이지"
            }
          >
            {suspicious ? "🐤" : "≠"}
          </span>
        )}
      </div>

      {/* Status / library id row — hidden in compact mode (info still in
          tooltips + footer) to save vertical space */}
      {!compact && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 font-bold ${
              isActive
                ? "bg-emerald-500/20 text-emerald-700"
                : "bg-slate-500/20 text-slate-700"
            }`}
          >
            {isActive ? "● 게재중" : "○ 종료"}
          </span>
          <span className="font-mono">ID {ad.adArchiveId}</span>
          {start && (
            <span className="ml-auto">
              {start}
              {stop && ` → ${stop}`}
            </span>
          )}
        </div>
      )}

      {/* Body text — only in comfy mode */}
      {!compact && body && (
        <div className="px-3 py-2 text-[12px] leading-snug">
          <div className="line-clamp-4 whitespace-pre-line">{body}</div>
        </div>
      )}

      {/* Media — square in comfy, capped 4:5 in compact so we get more
          cards on screen without losing the visual */}
      <div
        className={`relative w-full bg-[var(--bg-elev)] ${
          compact ? "aspect-[4/5]" : "aspect-square"
        }`}
      >
        {ad.mediaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.mediaUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-[var(--text-muted)]">
            (no preview)
          </div>
        )}
        {/* Media-type indicator — top-left corner badge */}
        {ad.mediaType && (
          <span
            className={`absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-bold backdrop-blur-md ${
              ad.mediaType === "video"
                ? "bg-rose-500/80 text-white"
                : "bg-slate-900/70 text-slate-100"
            } ${compact ? "text-[9px]" : "text-[10px]"}`}
            title={ad.mediaType === "video" ? "영상 광고" : "이미지 광고"}
          >
            {ad.mediaType === "video"
              ? compact
                ? "🎬"
                : "🎬 영상"
              : compact
                ? "🖼️"
                : "🖼️ 이미지"}
          </span>
        )}
        {/* Active-status pill in compact (since we hide the separate row) */}
        {compact && (
          <span
            className={`absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold backdrop-blur-md ${
              isActive
                ? "bg-emerald-500/80 text-white"
                : "bg-slate-700/80 text-slate-200"
            }`}
          >
            {isActive ? "●" : "○"}
          </span>
        )}
        {/* Center play overlay — only for video, smaller in compact */}
        {ad.mediaType === "video" && ad.mediaUrl && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className={`flex items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-md ${
                compact ? "h-8 w-8 text-base" : "h-12 w-12 text-2xl"
              }`}
            >
              ▶
            </div>
          </div>
        )}
      </div>

      {/* LP domain footer + Library link */}
      <div
        className={`flex flex-col gap-1 border-t border-[var(--border)] text-[10px] ${
          compact ? "px-2 py-1.5" : "px-3 py-2 gap-1.5"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate font-mono uppercase tracking-wide">
            {ad.lpDomain ? (
              <a
                href={ad.lpUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-600 hover:underline"
                title={ad.lpUrl ?? undefined}
              >
                {ad.lpDomain}
              </a>
            ) : (
              <span className="text-[var(--text-muted)]">—</span>
            )}
          </div>
          <a
            href={metaLibraryLink(ad.adArchiveId)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded bg-slate-700/40 px-1.5 py-0.5 text-[var(--text-muted)] hover:bg-slate-700 hover:text-[var(--text-primary)]"
          >
            Library ↗
          </a>
        </div>
        {!compact && ad.utmCampaign && (
          <div className="truncate font-mono text-[10px]">
            <span className="rounded bg-amber-500/15 px-1 py-0.5 text-amber-700">
              {ad.utmCampaign}
            </span>
            {ad.utmTerm && (
              <span className="ml-1 text-[var(--text-muted)]">
                · {ad.utmTerm}
              </span>
            )}
          </div>
        )}
        {!compact && desc && (
          <div className="line-clamp-2 italic text-[var(--text-muted)]">
            {desc}
          </div>
        )}
        {!compact && ad.lpUrl && (
          <a
            href={ad.lpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block rounded-md bg-blue-500/15 px-2 py-1.5 text-center text-[11px] font-semibold text-blue-700 hover:bg-blue-500/30"
          >
            더 알아보기 →
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Pages tab card — one row per running page (sock-puppet, official, etc.)
 * with a quick visual fingerprint (avatar + first ad's media + count).
 */
function PageCard({
  group,
}: {
  group: { pageName: string; pageId: string; ads: MetaAd[] };
}) {
  const sample = group.ads[0];
  const isSuspicious =
    /[lI1|]{4,}/.test(group.pageName) || // i+l obfuscation (e.g. Iiiililli...)
    /[぀-ヿͰ-ϿЀ-ӿ\u{1F100}-\u{1FFFF}]/u.test(
      group.pageName
    ); // mixed kana / Greek / Cyrillic / unicode emoji glyphs in a Korean ad name
  const lpDomains = new Set<string>();
  for (const a of group.ads) if (a.lpDomain) lpDomains.add(a.lpDomain);
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-3">
      <div className="flex items-center gap-2">
        {sample?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sample.avatarUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-10 w-10 shrink-0 rounded-full bg-slate-700 object-cover"
          />
        ) : (
          <div className="h-10 w-10 shrink-0 rounded-full bg-slate-700" />
        )}
        <div className="min-w-0 flex-1">
          <a
            href={
              group.pageId
                ? `https://www.facebook.com/${group.pageId}`
                : "#"
            }
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-semibold hover:text-blue-700 hover:underline"
          >
            {group.pageName}
          </a>
          <div className="text-[10px] text-[var(--text-muted)]">
            {group.pageId && (
              <span className="font-mono">{group.pageId}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-base font-bold">{group.ads.length}</div>
          <div className="text-[9px] text-[var(--text-muted)]">광고</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
        {isSuspicious && (
          <span
            className="rounded-full bg-rose-500/20 px-1.5 py-0.5 font-bold text-rose-700"
            title="페이지명에 유니코드 위장 글리프 또는 i/l 노이즈 감지"
          >
            🐤 위장
          </span>
        )}
        {Array.from(lpDomains)
          .slice(0, 3)
          .map((d) => (
            <span
              key={d}
              className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono uppercase text-emerald-700"
            >
              {d}
            </span>
          ))}
        {lpDomains.size > 3 && (
          <span className="text-[var(--text-muted)]">
            +{lpDomains.size - 3}
          </span>
        )}
      </div>
      {/* Mini media strip — first 4 thumbs as a brand fingerprint */}
      <div className="mt-2 flex gap-1 overflow-hidden">
        {group.ads.slice(0, 4).map((a) =>
          a.mediaUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={a.adArchiveId}
              src={a.mediaUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-16 w-16 shrink-0 rounded object-cover"
            />
          ) : (
            <div
              key={a.adArchiveId}
              className="h-16 w-16 shrink-0 rounded bg-[var(--bg-elev)]"
            />
          )
        )}
      </div>
    </div>
  );
}

/**
 * Live progress panel for in-progress Meta scrapes — mirrors the ATC
 * LogConsole pattern (stage chips + percent estimate + tail-N log
 * stream + auto-scroll). The Meta worker emits log lines via
 * appendLog; the parent polls every 3s, so this just renders the
 * latest snapshot.
 */
function MetaLiveProgress({
  status,
  logs,
}: {
  status: Status;
  logs: string[];
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll log to bottom on every new line.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Heuristic stage detection from the latest log line. Maps the
  // worker's free-text logs to a 4-stage progress model so the user
  // sees concrete stages instead of a static spinner.
  const lastLine = logs[logs.length - 1] ?? "";
  type Stage = "queued" | "search" | "discover" | "scoop" | "merge" | "done";
  let activeStage: Stage = "queued";
  let percent = 5;
  if (status === "queued") {
    activeStage = "queued";
    percent = 2;
  } else if (
    /\bextracting cards\b|\bgot \d+ ads\b|→ \d+ ads from page/.test(lastLine) ||
    /direct page scoop/.test(lastLine)
  ) {
    activeStage = "scoop";
    percent = 75;
  } else if (
    /auto-discovered|stage 1\.5|fetchAdvertiserPageId|page-mode/i.test(lastLine)
  ) {
    activeStage = "discover";
    percent = 55;
  } else if (
    /scrolling|search_terms|searchByTermsWeb|launch headless chromium/i.test(
      lastLine
    )
  ) {
    activeStage = "search";
    percent = 30;
  } else if (/\bdone\b|complete/i.test(lastLine)) {
    activeStage = "merge";
    percent = 95;
  } else if (logs.length > 0) {
    activeStage = "search";
    percent = 20;
  }

  const stages: { key: Stage; label: string; emoji: string }[] = [
    { key: "search", label: "검색어 스캔", emoji: "🔍" },
    { key: "discover", label: "광고주 발굴", emoji: "🌱" },
    { key: "scoop", label: "광고 수집", emoji: "📦" },
    { key: "merge", label: "저장", emoji: "💾" },
  ];
  const stageOrder: Stage[] = ["search", "discover", "scoop", "merge"];
  const activeIdx = stageOrder.indexOf(activeStage);

  // Quick adCount peek from log "got N ads" / "→ N ads from page".
  const adCount =
    [...logs].reverse().reduce<number | null>((acc, l) => {
      if (acc !== null) return acc;
      const m =
        l.match(/got\s+(\d+)\s+ads/) ||
        l.match(/→\s+(\d+)\s+ads from page/);
      return m ? parseInt(m[1], 10) : null;
    }, null) ?? null;

  return (
    <div className="my-4 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
      {/* Header — animated dot + status text + percent */}
      <div className="mb-3 flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400/60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-400" />
        </span>
        <span className="text-sm font-bold text-blue-700">
          {status === "queued" ? "🕒 대기 중..." : "📘 메타 수집 중"}
        </span>
        {adCount !== null && (
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
            지금까지 {adCount}개 잡힘
          </span>
        )}
        <span className="ml-auto text-xs font-mono text-blue-700">
          {percent}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-[var(--bg-base)]">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Stage chips */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        {stages.map((s, i) => {
          const isActive = i === activeIdx;
          const isDone = i < activeIdx;
          return (
            <div key={s.key} className="flex items-center gap-1.5">
              <span
                className={`flex items-center gap-1 rounded-full px-2 py-1 font-bold ${
                  isActive
                    ? "bg-blue-500/30 text-blue-200 ring-1 ring-blue-400/50"
                    : isDone
                      ? "bg-emerald-500/15 text-emerald-700"
                      : "bg-[var(--bg-elev)] text-[var(--text-muted)]"
                }`}
              >
                <span>
                  {isDone ? "✅" : isActive ? s.emoji : "⏳"}
                </span>
                {s.label}
              </span>
              {i < stages.length - 1 && (
                <span className="text-[var(--text-muted)]">→</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Live log stream — last 8 lines, auto-scroll, mono */}
      {logs.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-32 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--bg-base)] p-2 font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]"
        >
          {logs.slice(-12).map((l, i) => {
            const isImportant =
              /got\s+\d+|auto-discovered|🌱|🛡️|→\s+\d+\s+ads|🔒/.test(l);
            return (
              <div
                key={i}
                className={
                  isImportant
                    ? "text-emerald-700"
                    : "text-[var(--text-muted)]"
                }
              >
                {l}
              </div>
            );
          })}
        </div>
      )}
      {logs.length === 0 && status !== "queued" && (
        <div className="text-center text-[11px] text-[var(--text-muted)]">
          워커 시작 중... 첫 로그 곧 표시됨
        </div>
      )}
    </div>
  );
}
