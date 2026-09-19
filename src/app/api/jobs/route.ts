import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const jobs = await prisma.job.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ jobs });
}

/**
 * Delete jobs (and their associated ads/videos) by keyword + kind.
 * Body: { keyword: string, kind: 'ad' | 'youtube' }
 * Use this when the user clicks the trash icon next to a sidebar entry —
 * it wipes everything tied to that specific search.
 */
export async function DELETE(req: NextRequest) {
  let body: { keyword?: string; kind?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const keyword = body.keyword?.trim();
  const kind = body.kind === "youtube" ? "youtube" : "ad";
  if (!keyword) {
    return NextResponse.json({ error: "keyword required" }, { status: 400 });
  }

  // Delete dependent rows first (SetNull cascades from Job, but explicit
  // deletion gives us count and clarity).
  if (kind === "ad") {
    const ads = await prisma.ad.deleteMany({ where: { keyword } });
    const jobs = await prisma.job.deleteMany({
      where: { keyword, kind: "ad" },
    });
    return NextResponse.json({ ok: true, ads: ads.count, jobs: jobs.count });
  } else {
    const videos = await prisma.video.deleteMany({ where: { keyword } });
    const jobs = await prisma.job.deleteMany({
      where: { keyword, kind: "youtube" },
    });
    return NextResponse.json({
      ok: true,
      videos: videos.count,
      jobs: jobs.count,
    });
  }
}
