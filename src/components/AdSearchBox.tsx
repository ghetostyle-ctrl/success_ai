"use client";

import { useEffect, useState } from "react";
import type { AdvertiserSuggestion, DomainSuggestion } from "@/lib/atc-scraper";
import {
  LoaderCircle,
  Search,
} from "lucide-react";

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
      <Search
        size={16}
        strokeWidth={1.75}
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
      />
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
        className="field-input w-full pl-9 pr-28"
      />
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          onSearch();
        }}
        disabled={disabled}
        className="btn btn-primary btn-sm absolute right-1 top-1/2 -translate-y-1/2"
      >
        {buttonLabel}
      </button>

      {showSuggestions && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-80 overflow-y-auto rounded-panel border border-line bg-surface p-2 text-sm shadow-popover"
          role="group"
          aria-label="구글 광고 투명성 센터 관련 검색어"
        >
          {!current ? (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-faint" role="status">
              <LoaderCircle size={16} strokeWidth={1.75} aria-hidden className="animate-spin" />
              관련 검색어를 찾는 중…
            </p>
          ) : current.error ? (
            <p className="px-3 py-3 text-xs text-[var(--text-muted)]">{current.error}</p>
          ) : advertisers.length === 0 && current.domains.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[var(--text-muted)]">관련 검색어가 없습니다. 직접 불러오기를 눌러 검색할 수 있습니다.</p>
          ) : (
            <>
              {advertisers.length > 0 && (
                <div className="px-3 pb-1 pt-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_5rem_7rem] gap-2 border-b border-[var(--border)] pb-2 text-xs text-[var(--text-muted)]">
                    <span>광고주</span><span>위치</span><span className="text-right">광고 개수</span>
                  </div>
                  {advertisers.map((advertiser) => (
                    <button
                      key={advertiser.advertiserId}
                      type="button"
                      onClick={() => choose(advertiser.name)}
                      className="grid min-h-10 w-full grid-cols-[minmax(0,1fr)_5rem_7rem] items-center gap-2 rounded-sm px-1 py-2 text-left text-xs text-ink transition-colors hover:bg-surface-soft"
                    >
                      <span className="min-w-0 break-words font-medium">{advertiser.name}</span>
                      <span className="text-[var(--text-secondary)]">{advertiser.region === "KR" ? "대한민국" : advertiser.region}</span>
                      <span className="text-right tabular-nums text-[var(--text-secondary)]">{adCountLabel(advertiser)}</span>
                    </button>
                  ))}
                </div>
              )}
              {current.domains.length > 0 && (
                <div className="border-t border-[var(--border)] px-3 pb-1 pt-2">
                  <div className="pb-1 text-xs text-[var(--text-muted)]">웹사이트</div>
                  {current.domains.map((domain) => (
                    <button
                      key={domain.domain}
                      type="button"
                      onClick={() => choose(domain.domain)}
                      className="block min-h-10 w-full rounded-sm px-1 py-2 text-left text-xs text-ink transition-colors hover:bg-surface-soft"
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
