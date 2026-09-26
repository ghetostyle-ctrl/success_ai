import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { searchSuggestions } from "@/lib/atc-scraper";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  if (query.length < 2 || query.length > 100) {
    return NextResponse.json({ error: "query must be 2–100 characters" }, { status: 400 });
  }

  try {
    const suggestions = await searchSuggestions(query, "KR");
    return NextResponse.json(suggestions, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    console.error("ATC suggestions failed:", error);
    return NextResponse.json(
      { error: "관련 검색어를 불러오지 못했습니다." },
      { status: 502 }
    );
  }
}
