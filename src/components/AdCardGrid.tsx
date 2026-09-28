"use client";

import type { ReactNode } from "react";
import {
  ArrowUpRight,
} from "lucide-react";

type CardAd = {
  id: string;
  advertiserId: string;
  advertiserName: string;
  creativeId: string;
  region: string;
  type: string;
  imageHtml: string | null;
  previewImage: string | null;
  youtubeId: string | null;
};

type Props = {
  ads: CardAd[];
  keyword: string;
  totalCount: number;
  collectedCount: number;
  onClearFilters: () => void;
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string, checked: boolean) => void;
  selectionActions: ReactNode;
};

function previewImage(ad: CardAd): string | null {
  if (ad.youtubeId) return `https://i.ytimg.com/vi/${encodeURIComponent(ad.youtubeId)}/mqdefault.jpg`;
  if (ad.previewImage) return ad.previewImage;
  const imageSource = ad.imageHtml?.match(/<img[^>]+src=["'](https:\/\/[^"']+)["']/i);
  return imageSource?.[1] ?? null;
}

function creativeUrl(ad: CardAd): string {
  return `https://adstransparency.google.com/advertiser/${encodeURIComponent(ad.advertiserId)}/creative/${encodeURIComponent(ad.creativeId)}?region=${encodeURIComponent(ad.region)}`;
}

export function AdCardGrid({ ads, keyword, totalCount, collectedCount, onClearFilters, selectedIds, onToggle, selectionActions }: Props) {
  if (ads.length === 0) {
    return (
      <div className="panel empty text-base text-muted">
        {collectedCount > 0 ? (
          <>
            <p>광고 {collectedCount.toLocaleString()}개를 수집했지만 현재 필터에 맞는 소재가 없습니다.</p>
            <button type="button" onClick={onClearFilters} className="btn btn-secondary mt-3">
              필터 해제하고 모두 보기
            </button>
          </>
        ) : (
          <p>아직 불러온 광고가 없습니다.</p>
        )}
      </div>
    );
  }

  const advertiserIds = new Set(ads.map((ad) => ad.advertiserId));
  const advertiserName = advertiserIds.size === 1 ? ads[0].advertiserName || keyword : keyword;
  const advertiserUrl = advertiserIds.size === 1
    ? `https://adstransparency.google.com/advertiser/${encodeURIComponent(ads[0].advertiserId)}?region=${encodeURIComponent(ads[0].region)}`
    : null;
  const adsWithPreviewsFirst = [...ads].sort((a, b) => Number(Boolean(previewImage(b))) - Number(Boolean(previewImage(a))));

  return (
    <section className="space-y-4" aria-label={`${advertiserName} 광고 소재`}>
      <div className="panel px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">{advertiserName}</h2>
            <p className="mt-1 text-sm tabular-nums text-muted">대한민국 · 광고 {totalCount.toLocaleString()}개</p>
          </div>
          {advertiserUrl && (
            <a href={advertiserUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
              구글 광고 투명성 센터에서 보기
              <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />
            </a>
          )}
        </div>
      </div>
      {selectionActions}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {adsWithPreviewsFirst.map((ad) => {
          const image = previewImage(ad);
          return (
            <div key={ad.id} className={`relative overflow-hidden rounded-panel border transition-colors ${selectedIds.has(ad.creativeId) ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-line bg-surface hover:border-line-strong hover:shadow-xs"}`}>
              <label className="absolute left-3 top-3 z-10 flex cursor-pointer items-center gap-2 rounded-sm border border-line bg-surface px-2 py-1.5 text-sm font-semibold text-ink">
                <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" aria-label={`광고 ${ad.creativeId} 선택`} checked={selectedIds.has(ad.creativeId)} onChange={(event) => onToggle(ad.creativeId, event.target.checked)} />
                선택
              </label>
              <a href={creativeUrl(ad)} target="_blank" rel="noopener noreferrer" className="block">
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-surface-sunken">
                {image ? (
                  <img src={image} alt={`${ad.advertiserName} 광고 소재`} loading="lazy" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="inline-flex items-center gap-1 px-4 text-center text-sm text-faint">
                    미리보기는 원본에서 확인
                    <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-line bg-surface px-3 py-2 text-sm">
                <span className="truncate font-semibold text-[var(--text-primary)]">{ad.advertiserName || keyword}</span>
                <span className="shrink-0 text-[var(--text-muted)]">{ad.youtubeId ? "YouTube" : ad.type === "image" ? "이미지" : ad.type === "video" ? "영상" : "기타"}</span>
              </div>
              </a>
            </div>
          );
        })}
      </div>
    </section>
  );
}
