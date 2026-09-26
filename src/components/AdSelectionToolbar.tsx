"use client";

import { useState } from "react";

export type SelectionAd = {
  creativeId: string;
  advertiserId: string;
  advertiserName: string;
  region: string;
  youtubeId: string | null;
};

type Project = { id: string; name: string };

type Props = {
  selectedAds: SelectionAd[];
  visibleCount: number;
  visibleLabel?: string;
  onSelectAll: () => void;
  onClear: () => void;
};

function referenceUrl(ad: SelectionAd): string {
  if (ad.youtubeId) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(ad.youtubeId)}`;
  }
  return `https://adstransparency.google.com/advertiser/${encodeURIComponent(ad.advertiserId)}/creative/${encodeURIComponent(ad.creativeId)}?region=${encodeURIComponent(ad.region)}`;
}

async function factoryRequest(method: "GET" | "POST", body?: object): Promise<unknown> {
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
}

function isProject(value: unknown): value is Project {
  return Boolean(value && typeof value === "object" && "id" in value && "name" in value
    && typeof value.id === "string" && typeof value.name === "string");
}

export function AdSelectionToolbar({ selectedAds, visibleCount, visibleLabel, onSelectAll, onClear }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [showSend, setShowSend] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const openSend = async () => {
    setShowSend(true);
    setMessage("");
    setPending(true);
    try {
      const data = await factoryRequest("GET");
      if (!data || typeof data !== "object" || !("projects" in data)
        || !Array.isArray(data.projects) || !data.projects.every(isProject)) throw new Error("프로젝트 목록을 읽지 못했습니다.");
      const listed: Project[] = data.projects;
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
      const data = await factoryRequest("POST", { name: newProjectName.trim() });
      if (!isProject(data)) throw new Error("새 프로젝트를 확인하지 못했습니다.");
      setProjects((current) => [...current, data]);
      setProjectId(data.id);
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
      const data = await factoryRequest("POST", { projectId, ids: selectedAds.map((ad) => ad.creativeId) });
      if (!data || typeof data !== "object" || !("count" in data) || typeof data.count !== "number") throw new Error("저장 결과를 확인하지 못했습니다.");
      setShowSend(false);
      setMessage(`${data.count}개 광고를 AD FACTORY 프로젝트에 저장했습니다.`);
      onClear();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "광고를 보내지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  const copySelected = async () => {
    try {
      await navigator.clipboard.writeText(selectedAds.map((ad) => `${ad.advertiserName} | ${referenceUrl(ad)}`).join("\n") + "\n");
      setMessage(`${selectedAds.length}개 광고 링크를 복사했습니다.`);
    } catch {
      setMessage("클립보드에 복사하지 못했습니다. 브라우저 권한을 확인하세요.");
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-xs">
        <strong className="mr-auto text-[var(--text-primary)]">선택 {selectedAds.length}개 / {visibleLabel ?? `표시 ${visibleCount}개`}</strong>
        <button type="button" onClick={onSelectAll} disabled={visibleCount === 0} className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 disabled:opacity-40">표시된 광고 전체 선택</button>
        <button type="button" onClick={onClear} disabled={selectedAds.length === 0} className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 disabled:opacity-40">선택 해제</button>
        <button type="button" onClick={() => void copySelected()} disabled={selectedAds.length === 0} className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 disabled:opacity-40">선택 링크 복사</button>
        <button type="button" onClick={() => void openSend()} disabled={selectedAds.length === 0 || selectedAds.length > 100} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-semibold text-white disabled:opacity-40">AD FACTORY로 보내기</button>
        {selectedAds.length > 100 && <span className="text-amber-700">한 번에 최대 100개까지 보낼 수 있습니다.</span>}
      </div>
      {message && <p role="status" className="rounded-lg bg-[var(--bg-card)] px-4 py-2 text-xs text-[var(--text-secondary)]">{message}</p>}
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
    </>
  );
}
