import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const videos = await prisma.video.findMany({
    orderBy: { savedAt: "desc" },
    take: 500,
  });
  return NextResponse.json({ videos });
}

export async function DELETE(req: NextRequest) {
  // 관리자 전용 — videos + jobs 전체 삭제. ADMIN_DELETE_SECRET 헤더 검증.
  // (page.tsx clearAll 이 /api/ads 와 동일한 secret 헤더로 호출)
  const expected = process.env.ADMIN_DELETE_SECRET;
  const provided = req.headers.get("x-admin-secret");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }
  await prisma.video.deleteMany();
  await prisma.job.deleteMany();
  return NextResponse.json({ ok: true });
}
