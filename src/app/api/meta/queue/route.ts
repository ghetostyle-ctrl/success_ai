import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueMetaJob } from "@/lib/meta-worker";
import { normalizeMetaKeyword } from "../../meta-watch/route";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: { keyword?: string; pageId?: string; region?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  // Two queue modes:
  //   - keyword:  text search (search_terms → discover pages → search_page_ids)
  //   - pageId:   direct page-scoped scoop (catches ads that text search
  //               misses because the operating sock-puppet page name doesn't
  //               include the brand keyword)
  // The worker reads the keyword field to drive the scrape; we encode the
  // page-id mode by prefixing it with "page:" so the existing pipeline
  // routes to searchByPageIdWeb without schema changes.
  const pageId = body.pageId?.trim();
  const rawKeyword = body.keyword?.trim();
  if (!pageId && !rawKeyword) {
    return NextResponse.json(
      { error: "keyword or pageId required" },
      { status: 400 }
    );
  }
  // Strip URL prefix/suffix on keyword — Meta searches the literal
  // string, and "https://example-shop.com/" returns 0 while
  // "example-shop.com" returns 48. Matches MetaWatch normalization.
  const keyword = rawKeyword ? normalizeMetaKeyword(rawKeyword) : undefined;
  const storedKeyword = pageId ? `page:${pageId}` : keyword!;
  const job = await prisma.metaJob.create({
    data: {
      keyword: storedKeyword,
      region: body.region ?? "KR",
      status: "queued",
    },
  });
  enqueueMetaJob(job.id);
  return NextResponse.json({ id: job.id, status: "queued", mode: pageId ? "page" : "keyword" });
}
