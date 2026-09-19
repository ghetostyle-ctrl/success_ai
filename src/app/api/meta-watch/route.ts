import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * MetaWatch CRUD — registers brand keywords (or `page:<id>` directives)
 * for the daily Meta Ad Library re-scrape inside scripts/run-tracked.ts.
 */

/**
 * Normalize a keyword before storing/searching. Meta library matches
 * the user's text literally — passing "https://example-shop.com/" returns
 * 0 results because Meta isn't searching the URL string in ad content,
 * while "example-shop.com" returns 48. We strip protocol + www. + trailing
 * slash so the user can paste a URL but still get useful results.
 *
 * Page-id directives ("page:1234567890") are passed through untouched.
 */
export function normalizeMetaKeyword(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("page:")) return s;
  return s
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "") // strip path/query
    .trim();
}

export async function GET() {
  const watches = await prisma.metaWatch.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ watches });
}

export async function POST(req: NextRequest) {
  let body: { keyword?: string; region?: string; active?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const rawKw = body.keyword?.trim();
  if (!rawKw) {
    return NextResponse.json({ error: "keyword required" }, { status: 400 });
  }
  const keyword = normalizeMetaKeyword(rawKw);
  if (!keyword) {
    return NextResponse.json(
      { error: "keyword empty after normalization" },
      { status: 400 }
    );
  }
  const region = body.region ?? "KR";
  const watch = await prisma.metaWatch.upsert({
    where: { keyword_region: { keyword, region } },
    create: { keyword, region, active: body.active ?? true },
    update: { active: body.active ?? true },
  });
  return NextResponse.json({
    watch,
    normalized: rawKw !== keyword ? { from: rawKw, to: keyword } : null,
  });
}

export async function DELETE(req: NextRequest) {
  let body: { id?: string; keyword?: string; region?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  // Watch 와 함께 그 keyword 의 MetaJob 도 같이 정리. 그렇게 안 하면
  // 사이드바의 metaBrandGroups Step3(orphan: jobs만 있는 keyword 도
  // brand 표시) 가 brand 카드를 계속 띄워 "✕ 눌렀는데 안 사라짐" 이
  // 된다. MetaAd 광고 자체는 유지(다시 추적하면 그대로 복구).
  if (body.id) {
    const w = await prisma.metaWatch
      .delete({ where: { id: body.id } })
      .catch(() => null);
    if (w) {
      await prisma.metaJob
        .deleteMany({ where: { keyword: w.keyword, region: w.region } })
        .catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }
  const keyword = body.keyword?.trim();
  if (!keyword) {
    return NextResponse.json(
      { error: "id or keyword required" },
      { status: 400 }
    );
  }
  const region = body.region ?? "KR";
  await prisma.metaWatch.deleteMany({ where: { keyword, region } });
  await prisma.metaJob
    .deleteMany({ where: { keyword, region } })
    .catch(() => {});
  return NextResponse.json({ ok: true });
}
