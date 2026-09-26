"use client";

import { useState } from "react";

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

export function AdCardGrid({ ads, keyword, totalCount, collectedCount, onClearFilters }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [showSend, setShowSend] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const selectedAds = ads.filter((ad) => selectedIds.has(ad.creativeId));

  const request = async (method: "GET" | "POST", body?: object) => {
    const response = await fetch("/api/ad-factory", {
      method,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      cache: "no-store",
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const error = data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error : "요청을 완료하지 못했습니다.";
      throw new Error(error);
    }
    return data;
  };

  const openSend = async () => {
    setShowSend(true);
    setMessage("");
    setPending(true);
    try {
      const data = await request("GET");
      if (!data || typeof data !== "object" || !("projects" in data) || !Array.isArray(data.projects)) throw new Error("프로젝트 목록을 읽지 못했습니다.");
      const listed = data.projects as { id: string; name: string }[];
      setProjects(listed);
      setProjectId((current) => listed.some((project) => project.id === current) ? current : listed[0]?.id ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AD FACTORY에 연결하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  const createProject = async () => {
    setPending(true);
    setMessage("");
    try {
      const data = await request("POST", { name: newProjectName.trim() });
      if (!data || typeof data !== "object" || !("id" in data) || !("name" in data)
        || typeof data.id !== "string" || typeof data.name !== "string") throw new Error("새 프로젝트를 확인하지 못했습니다.");
      const id = data.id;
      const name = data.name;
      setProjects((current) => [...current, { id, name }]);
      setProjectId(id);
      setNewProjectName("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "프로젝트를 만들지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  const sendSelected = async () => {
    setPending(true);
    setMessage("");
    try {
      const data = await request("POST", { projectId, ids: selectedAds.map((ad) => ad.creativeId) });
      if (!data || typeof data !== "object" || !("count" in data) || typeof data.count !== "number") throw new Error("저장 결과를 확인하지 못했습니다.");
      setShowSend(false);
      setMessage(`${data.count}개 광고를 AD FACTORY 프로젝트에 저장했습니다.`);
      setSelectedIds(new Set());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "광고를 보내지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  const copySelected = async () => {
    try {
      await navigator.clipboard.writeText(selectedAds.map((ad) => `${ad.advertiserName || keyword} | ${creativeUrl(ad)}`).join("\n") + "\n");
      setMessage(`${selectedAds.length}개 광고 링크를 복사했습니다.`);
    } catch {
      setMessage("클립보드에 복사하지 못했습니다. 브라우저 권한을 확인하세요.");
    }
  };

  if (ads.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-card)] px-6 py-12 text-center text-sm text-[var(--text-secondary)]">
        {collectedCount > 0 ? (
          <>
            <p>광고 {collectedCount.toLocaleString()}개를 수집했지만 현재 필터에 맞는 소재가 없습니다.</p>
            <button type="button" onClick={onClearFilters} className="mt-3 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white">
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
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">{advertiserName}</h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">대한민국 · 광고 {totalCount.toLocaleString()}개</p>
          </div>
          {advertiserUrl && (
            <a href={advertiserUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-[var(--border-strong)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--accent)]">
              구글 광고 투명성 센터에서 보기 ↗
            </a>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-xs">
        <strong className="mr-auto text-[var(--text-primary)]">선택 {selectedAds.length}개 / 표시 {ads.length}개</strong>
        <button type="button" onClick={() => setSelectedIds(new Set(ads.map((ad) => ad.creativeId)))} className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5">표시된 광고 전체 선택</button>
        <button type="button" onClick={() => setSelectedIds(new Set())} disabled={selectedAds.length === 0} className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 disabled:opacity-40">선택 해제</button>
        <button type="button" onClick={() => void copySelected()} disabled={selectedAds.length === 0} className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 disabled:opacity-40">선택 링크 복사</button>
        <button type="button" onClick={() => void openSend()} disabled={selectedAds.length === 0 || selectedAds.length > 100} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-semibold text-white disabled:opacity-40">AD FACTORY로 보내기</button>
        {selectedAds.length > 100 && <span className="text-amber-700">한 번에 최대 100개까지 보낼 수 있습니다.</span>}
      </div>
      {message && <p role="status" className="rounded-lg bg-[var(--bg-card)] px-4 py-2 text-xs text-[var(--text-secondary)]">{message}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {adsWithPreviewsFirst.map((ad) => {
          const image = previewImage(ad);
          return (
            <div key={ad.id} className={`relative overflow-hidden rounded-xl border bg-[var(--bg-card)] shadow-sm transition hover:shadow-md ${selectedIds.has(ad.creativeId) ? "border-[var(--accent)] ring-2 ring-[var(--accent)]" : "border-[var(--border)]"}`}>
              <label className="absolute left-3 top-3 z-10 flex cursor-pointer items-center gap-2 rounded-lg bg-[var(--bg-card)] px-2 py-1.5 text-xs font-semibold shadow-sm">
                <input type="checkbox" aria-label={`광고 ${ad.creativeId} 선택`} checked={selectedIds.has(ad.creativeId)} onChange={(event) => setSelectedIds((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(ad.creativeId);
                  else next.delete(ad.creativeId);
                  return next;
                })} />
                선택
              </label>
              <a href={creativeUrl(ad)} target="_blank" rel="noopener noreferrer" className="block hover:border-[var(--accent)]">
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-[var(--bg-elev)]">
                {image ? (
                  <img src={image} alt={`${ad.advertiserName} 광고 소재`} loading="lazy" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="px-4 text-center text-xs text-[var(--text-muted)]">미리보기는 원본에서 확인 ↗</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2 text-xs">
                <span className="truncate font-semibold text-[var(--text-primary)]">{ad.advertiserName || keyword}</span>
                <span className="shrink-0 text-[var(--text-muted)]">{ad.youtubeId ? "YouTube" : ad.type === "image" ? "이미지" : ad.type === "video" ? "영상" : "기타"}</span>
              </div>
              </a>
            </div>
          );
        })}
      </div>
      {showSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onClick={() => !pending && setShowSend(false)}>
          <div role="dialog" aria-modal="true" aria-label="AD FACTORY로 광고 보내기" onClick={(event) => event.stopPropagation()} className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-xl">
            <div>
              <h3 className="text-lg font-bold text-[var(--text-primary)]">AD FACTORY로 보내기</h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">선택한 광고 {selectedAds.length}개를 프로젝트 자료에 저장합니다.</p>
            </div>
            <label className="block text-sm font-semibold text-[var(--text-primary)]">저장할 프로젝트
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={pending || projects.length === 0} className="mt-2 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-2">
                {projects.length === 0 && <option value="">프로젝트가 없습니다</option>}
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <div className="space-y-2 border-t border-[var(--border)] pt-4">
              <label htmlFor="new-factory-project" className="block text-sm font-semibold text-[var(--text-primary)]">새 프로젝트 만들기</label>
              <div className="flex gap-2">
                <input id="new-factory-project" value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="내 상품 또는 광고 프로젝트 이름" disabled={pending} className="min-w-0 flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elev)] px-3 py-2 text-sm" />
                <button type="button" onClick={() => void createProject()} disabled={pending || newProjectName.trim().length < 2} className="rounded-lg border border-[var(--border-strong)] px-3 py-2 text-xs disabled:opacity-40">만들기</button>
              </div>
            </div>
            {message && <p role="alert" className="text-xs text-rose-600">{message}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowSend(false)} disabled={pending} className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm">취소</button>
              <button type="button" onClick={() => void sendSelected()} disabled={pending || !projectId} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{pending ? "처리 중…" : `${selectedAds.length}개 저장`}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
