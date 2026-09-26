import { prisma } from "@/lib/db";
import { exportSelectedReferences } from "@/lib/reference-export";
import { ReferenceExportError } from "@/lib/reference-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const factoryOrigin = "http://127.0.0.1:4317";

function localRequest(request: Request, write = false): boolean {
  const url = new URL(request.url);
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
  if (!write) return true;
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const source = new URL(origin);
    return source.host === host && ["localhost", "127.0.0.1", "[::1]"].includes(source.hostname);
  } catch {
    return false;
  }
}

async function factory(path: string, init?: RequestInit): Promise<Response> {
  const health = await fetch(`${factoryOrigin}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!health.ok || (await health.json()).app !== "meta-ad-studio") throw new Error("AD FACTORY 서버를 확인할 수 없습니다.");
  return fetch(`${factoryOrigin}/api/${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", Origin: factoryOrigin },
  });
}

async function result(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error : `AD FACTORY 요청이 실패했습니다. (${response.status})`;
    throw new Error(error);
  }
  return body;
}

export async function GET(request: Request) {
  if (!localRequest(request)) return Response.json({ error: "이 기능은 로컬 앱에서만 사용할 수 있습니다." }, { status: 403 });
  try {
    const body = await result(await factory("projects"));
    if (!body || typeof body !== "object" || !("projects" in body) || !Array.isArray(body.projects)) throw new Error("프로젝트 목록 형식이 맞지 않습니다.");
    const projects = body.projects.map((project: unknown) => {
      if (!project || typeof project !== "object" || !("id" in project) || !("name" in project)
        || typeof project.id !== "string" || typeof project.name !== "string") throw new Error("프로젝트 정보 형식이 맞지 않습니다.");
      return { id: project.id, name: project.name };
    });
    return Response.json({ projects }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "AD FACTORY에 연결할 수 없습니다. 4317 포트의 앱 실행 상태를 확인하세요." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!localRequest(request, true)) return Response.json({ error: "이 기능은 같은 컴퓨터의 Success AI 화면에서만 사용할 수 있습니다." }, { status: 403 });
  let input: unknown;
  try { input = await request.json(); } catch { return Response.json({ error: "요청 형식이 맞지 않습니다." }, { status: 400 }); }
  if (!input || typeof input !== "object") return Response.json({ error: "요청 형식이 맞지 않습니다." }, { status: 400 });

  try {
    if ("name" in input) {
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (name.length < 2 || name.length > 120) return Response.json({ error: "프로젝트 이름은 2~120자로 입력하세요." }, { status: 400 });
      const project = await result(await factory("projects", { method: "POST", body: JSON.stringify({ name, description: "" }) }));
      return Response.json(project, { headers: { "Cache-Control": "no-store" } });
    }
    const projectId = "projectId" in input ? input.projectId : null;
    const ids = "ids" in input ? input.ids : null;
    if (typeof projectId !== "string" || !/^[a-f0-9-]{36}$/i.test(projectId) || !Array.isArray(ids)
      || ids.length < 1 || ids.length > 100 || ids.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) {
      return Response.json({ error: "프로젝트와 1~100개의 광고를 선택하세요." }, { status: 400 });
    }
    const payload = await exportSelectedReferences(prisma, { platform: "google", mode: "ids", ids: [...new Set(ids)] });
    await result(await factory(`projects/${projectId}/import`, { method: "POST", body: JSON.stringify(payload) }));
    return Response.json({ count: payload.items.length, projectId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ReferenceExportError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : "AD FACTORY에 연결할 수 없습니다." }, { status: 503 });
  }
}
