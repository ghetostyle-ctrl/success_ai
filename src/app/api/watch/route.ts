import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { looksLikeDomain, normalizeDomain } from "@/lib/atc-scraper";

export async function GET() {
  const watches = await prisma.watch.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ watches });
}

/**
 * Create or toggle a watch.
 * Body: { keyword, kind: 'ad'|'youtube', region?: 'KR', active?: boolean }
 *
 * If a watch exists for the same (keyword, kind, region), its `active`
 * flag is toggled (or set to the value passed). Otherwise a new one is
 * created with active=true.
 */
export async function POST(req: NextRequest) {
  let body: {
    keyword?: string;
    kind?: string;
    region?: string;
    active?: boolean;
    daily?: boolean; // 격일(false)/매일(true) 티어 토글
    tier?: string | null; // "A1"|"A2"|"A3"|null — 중요도 그룹 (색 chip)
    tags?: string[] | null; // 자유 태그 배열 (통째 교체)
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const rawKw = body.keyword?.trim();
  if (!rawKw) {
    return NextResponse.json({ error: "keyword required" }, { status: 400 });
  }
  // URL → domain normalization for ad-mode keywords. Stops the
  // "https://example-shop.com/" → 0 results trap. YouTube-mode keywords
  // are search terms, leave them untouched.
  const kind = body.kind === "youtube" ? "youtube" : "ad";
  const keyword =
    kind === "ad" && looksLikeDomain(rawKw) ? normalizeDomain(rawKw) : rawKw;
  const region = body.region ?? "KR";

  const existing = await prisma.watch.findUnique({
    where: {
      keyword_kind_region: { keyword, kind, region },
    },
  });

  if (existing) {
    // 명시된 필드만 변경 (tier/tags/daily 는 active 안 건드림).
    // 아무것도 명시 안 되면 = 기존 동작 (active 토글).
    const data: {
      daily?: boolean;
      tier?: string | null;
      tags?: string | null;
      active?: boolean;
    } = {};
    if (body.daily !== undefined) data.daily = body.daily;
    if (body.tier !== undefined) data.tier = body.tier;
    if (body.tags !== undefined)
      data.tags = body.tags === null ? null : JSON.stringify(body.tags);
    if (Object.keys(data).length === 0) {
      data.active = body.active ?? !existing.active;
    } else if (body.active !== undefined) {
      data.active = body.active;
    }
    const updated = await prisma.watch.update({
      where: { id: existing.id },
      data,
    });
    return NextResponse.json({ watch: updated });
  }

  const created = await prisma.watch.create({
    data: {
      keyword,
      kind,
      region,
      active: body.active ?? true,
      daily: body.daily ?? false,
      tier: body.tier ?? null,
      tags: body.tags ? JSON.stringify(body.tags) : null,
    },
  });
  return NextResponse.json({ watch: created });
}

/**
 * Delete a watch.
 * Body: { keyword, kind, region? }
 */
export async function DELETE(req: NextRequest) {
  let body: { keyword?: string; kind?: string; region?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const keyword = body.keyword?.trim();
  if (!keyword) {
    return NextResponse.json({ error: "keyword required" }, { status: 400 });
  }
  const kind = body.kind === "youtube" ? "youtube" : "ad";
  const region = body.region ?? "KR";
  const result = await prisma.watch.deleteMany({
    where: { keyword, kind, region },
  });
  return NextResponse.json({ ok: true, deleted: result.count });
}
