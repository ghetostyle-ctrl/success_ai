import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxBytes = 200 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"]);

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const id = query.get("id") ?? "";
  const kind = query.get("kind");
  const platform = query.get("platform");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || (kind !== "image" && kind !== "video") ||
    (platform !== "meta" && platform !== "google") || (platform === "google" && kind === "video"))
    return Response.json({ error: "광고 ID 또는 미디어 종류가 올바르지 않습니다." }, { status: 400 });

  let rawUrl: string | null | undefined;
  if (platform === "meta") {
    const ad = await prisma.metaAd.findUnique({
      where: { adArchiveId: id }, select: { mediaUrl: true, videoUrl: true },
    });
    rawUrl = kind === "image" ? ad?.mediaUrl : ad?.videoUrl;
  } else {
    const ad = await prisma.ad.findUnique({
      where: { creativeId: id }, select: { previewImage: true },
    });
    rawUrl = ad?.previewImage;
  }
  if (!rawUrl) return Response.json({ error: "저장된 미디어 주소가 없습니다." }, { status: 404 });
  const mediaUrl = new URL(rawUrl);
  const host = mediaUrl.hostname.toLowerCase();
  const allowedHost = platform === "meta"
    ? host.endsWith(".fbcdn.net") || host.endsWith(".cdninstagram.com")
    : host.endsWith(".googlesyndication.com") || host.endsWith(".gstatic.com") ||
      host.endsWith(".googleusercontent.com");
  if (mediaUrl.protocol !== "https:" || mediaUrl.username || mediaUrl.password || !allowedHost)
    return Response.json({ error: "허용되지 않은 미디어 출처입니다." }, { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetch(mediaUrl, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  } catch {
    return Response.json({ error: "원본 미디어를 가져오지 못했습니다." }, { status: 503 });
  }
  const type = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const length = Number(upstream.headers.get("content-length"));
  if (!upstream.ok || !upstream.body || !allowedTypes.has(type) ||
    (kind === "image" ? !type.startsWith("image/") : !type.startsWith("video/")) ||
    (Number.isFinite(length) && length > maxBytes)) {
    await upstream.body?.cancel();
    return Response.json({ error: "원본 미디어 형식 또는 크기를 확인할 수 없습니다." }, { status: 503 });
  }
  let received = 0;
  const bounded = upstream.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBytes) throw new Error("미디어 크기 제한을 초과했습니다.");
      controller.enqueue(chunk);
    },
  }));
  return new Response(bounded, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="meta-${id}.${type.split("/")[1]}"`,
    },
  });
}
