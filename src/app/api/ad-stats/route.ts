/**
 * Ad-stats lazy endpoint — /api/ads 응답에서 빠진 stats 시계열을
 * 클라이언트가 별도로 가져오는 용도.
 *
 * Why: /api/ads 가 광고 본체 + stats 합치면 12MB 가까이 됨. 한국 ↔ Singapore
 * 다운로드 5~8초로 첫 화면이 답답. 본체만 먼저 (~2MB) 보여주고 stats 는
 * 백그라운드에서 받아 변화 컬럼만 채우면 사용자 체감 5배 빠름.
 *
 * 응답: 같은 shape ( { stats: { creativeId → AdStat[] } } ) — 90일 cap.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { brotliCompressSync, gzipSync, constants as zlibConst } from "node:zlib";

function compressedJson(body: unknown, acceptEncoding: string | null): Response {
  const json = JSON.stringify(body);
  const ae = acceptEncoding ?? "";
  if (ae.includes("br")) {
    const buf = brotliCompressSync(Buffer.from(json), {
      params: { [zlibConst.BROTLI_PARAM_QUALITY]: 4 },
    });
    return new Response(buf, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "br",
        "Cache-Control": "no-store",
      },
    });
  }
  if (ae.includes("gzip")) {
    const buf = gzipSync(Buffer.from(json), { level: 6 });
    return new Response(buf, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "gzip",
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(json, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  // 90일 cap — analyzeDays 최대값과 동일.
  const cutoffDate = new Date(Date.now() - 90 * 86400000)
    .toISOString()
    .slice(0, 10);

  // 모든 stats 한 번에 — chunk 없이. capturedDate 필터 덕분에 row 수 제한적.
  const stats = await prisma.adStat.findMany({
    where: { capturedDate: { gte: cutoffDate } },
    orderBy: { capturedDate: "asc" },
    select: {
      creativeId: true,
      capturedDate: true,
      views: true,
      likes: true,
      comments: true,
    },
  });

  // creativeId → AdStat[] map 으로 그룹화.
  const byCid: Record<
    string,
    Array<{
      creativeId: string;
      capturedDate: string;
      views: number;
      likes: number;
      comments: number;
    }>
  > = {};
  for (const s of stats) {
    (byCid[s.creativeId] ??= []).push(s);
  }

  return compressedJson(
    { stats: byCid },
    req.headers.get("accept-encoding")
  );
}
