"use client";

import { useEffect, useState } from "react";
import type { AdvertiserSuggestion, DomainSuggestion } from "@/lib/atc-scraper";

type Suggestions = {
  query: string;
  advertisers: AdvertiserSuggestion[];
  domains: DomainSuggestion[];
  error?: string;
};

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  buttonLabel: string;
  disabled: boolean;
};

function adCountLabel(advertiser: AdvertiserSuggestion): string {
  const { adCountLow, adCountHigh } = advertiser;
  if (adCountLow === adCountHigh) return `광고 약 ${adCountHigh.toLocaleString()}개`;
  return `광고 ${adCountLow.toLocaleString()}~${adCountHigh.toLocaleString()}개`;
}

export function AdSearchBox({
  query,
  onQueryChange,
  onSearch,
  buttonLabel,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const term = query.trim();
  const showSuggestions = open && term.length >= 2 && !/[,\n]/.test(term);
  const current = suggestions?.query === term ? suggestions : null;
  const advertisers = current
    ? [...current.advertisers].sort((a, b) => b.adCountHigh - a.adCountHigh)
    : [];

  useEffect(() => {
    if (!showSuggestions) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/ads/suggestions?query=${encodeURIComponent(term)}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error(`Suggestions HTTP ${response.status}`);
        const data: Pick<Suggestions, "advertisers" | "domains"> = await response.json();
        if (!controller.signal.aborted) setSuggestions({ query: term, ...data });
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions({
            query: term,
            advertisers: [],
            domains: [],
            error: "관련 검색어를 불러오지 못했습니다. 직접 검색은 계속할 수 있습니다.",
          });
        }
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [showSuggestions, term]);

  const choose = (value: string) => {
    onQueryChange(value);
    setOpen(false);
  };

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setOpen(false);
        }
      }}
    >
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base text-[var(--text-muted)]">
        🔍
      </span>
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter") {
            event.preventDefault();
            setOpen(false);
            onSearch();
          }
        }}
        placeholder="브랜드명 또는 도메인으로 검색 (예: 올리브영, oliveyoung.co.kr)"
        aria-label="브랜드명 또는 도메인 검색"
        autoComplete="off"
        className="w-full rounded-full border border-[var(--border-strong)] bg-[var(--bg-elev)] py-3 pl-11 pr-32 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:bg-[var(--bg-card)] focus:ring-4 focus:ring-[var(--accent-soft)]"
      />
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          onSearch();
        }}
        disabled={disabled}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {buttonLabel}
      </button>

      {showSuggestions && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-80 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-2 text-sm shadow-xl"
          role="group"
          aria-label="구글 광고 투명성 센터 관련 검색어"
        >
          {!current ? (
            <p className="px-3 py-3 text-xs text-[var(--text-muted)]">관련 검색어를 찾는 중…</p>
          ) : current.error ? (
            <p className="px-3 py-3 text-xs text-[var(--text-muted)]">{current.error}</p>
          ) : advertisers.length === 0 && current.domains.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[var(--text-muted)]">관련 검색어가 없습니다. 직접 불러오기를 눌러 검색할 수 있습니다.</p>
          ) : (
            <>
              {advertisers.length > 0 && (
                <div className="px-3 pb-1 pt-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_5rem_7rem] gap-2 border-b border-[var(--border)] pb-2 text-[11px] text-[var(--text-muted)]">
                    <span>광고주</span><span>위치</span><span className="text-right">광고 개수</span>
                  </div>
                  {advertisers.map((advertiser) => (
                    <button
                      key={advertiser.advertiserId}
                      type="button"
                      onClick={() => choose(advertiser.name)}
                      className="grid w-full grid-cols-[minmax(0,1fr)_5rem_7rem] gap-2 rounded-md px-1 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-elev)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                    >
                      <span className="min-w-0 break-words font-medium">{advertiser.name}</span>
                      <span className="text-[var(--text-secondary)]">{advertiser.region === "KR" ? "대한민국" : advertiser.region}</span>
                      <span className="text-right text-[var(--text-secondary)]">{adCountLabel(advertiser)}</span>
                    </button>
                  ))}
                </div>
              )}
              {current.domains.length > 0 && (
                <div className="border-t border-[var(--border)] px-3 pb-1 pt-2">
                  <div className="pb-1 text-[11px] text-[var(--text-muted)]">웹사이트</div>
                  {current.domains.map((domain) => (
                    <button
                      key={domain.domain}
                      type="button"
                      onClick={() => choose(domain.domain)}
                      className="block w-full rounded-md px-1 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-elev)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                    >
                      {domain.domain}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
