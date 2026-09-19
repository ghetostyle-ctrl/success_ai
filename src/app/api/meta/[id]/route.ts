import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const job = await prisma.metaJob.findUnique({
    where: { id },
    include: {
      ads: { orderBy: { savedAt: "desc" }, take: 1000 },
    },
  });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Cheap parse — UI can read these as actual arrays without doing it
  // itself. Bodies/etc are JSON-encoded strings on disk.
  const parseArr = (s: string | null): string[] => {
    if (!s) return [];
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };

  const rawLogs = (job.logs ?? "").split("\n").filter(Boolean);
  return NextResponse.json({
    id: job.id,
    keyword: job.keyword,
    region: job.region,
    status: job.status,
    adCount: job.adCount,
    pageCount: job.pageCount,
    errorMsg: job.errorMsg,
    createdAt: job.createdAt,
    ads: job.ads.map((a) => ({
      adArchiveId: a.adArchiveId,
      pageId: a.pageId,
      pageName: a.pageName,
      bodies: parseArr(a.bodies),
      linkTitles: parseArr(a.linkTitles),
      linkDescriptions: parseArr(a.linkDescriptions),
      linkCaptions: parseArr(a.linkCaptions),
      snapshotUrl: a.snapshotUrl,
      startTime: a.startTime,
      stopTime: a.stopTime,
      languages: parseArr(a.languages),
      publisherPlatforms: parseArr(a.publisherPlatforms),
      mediaUrl: a.mediaUrl,
      mediaType: a.mediaType,
      avatarUrl: a.avatarUrl,
      lpUrl: a.lpUrl,
      lpDomain: a.lpDomain,
      utmCampaign: a.utmCampaign,
      utmTerm: a.utmTerm,
      utmContent: a.utmContent,
      savedAt: a.savedAt,
    })),
    logs: rawLogs,
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  await prisma.metaAd.deleteMany({ where: { jobId: id } });
  await prisma.metaJob.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
