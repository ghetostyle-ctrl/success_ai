/**
 * POST /api/ads/ingest-url
 *
 * Direct URL ingest for ATC creatives that the brand-search path
 * misses. Two scenarios:
 *
 *  (1) The ad is still active → we scrape advertiser+creative+previewUrl
 *      from the URL and save to DB.
 *  (2) The ad was dropped from ATC → page returns "광고를 찾을 수 없음".
 *      Honest 404 response so the user knows it's not recoverable.
 *
 * Accepted URL formats:
 *   - https://adstransparency.google.com/advertiser/{ARxxx}/creative/{CRyyy}?region=KR
 *   - https://adstransparency.google.com/advertiser/{ARxxx}?region=KR
 *
 * For the second form (advertiser-only) we trigger the existing
 * advertiser-mode scrape path so all currently-active ads under that
 * advertiser get pulled in (often what the user actually wants).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { chromium } from "playwright";
import { getAdsForAdvertisers } from "@/lib/atc-scraper";

const URL_RE =
  /adstransparency\.google\.com\/advertiser\/(AR[A-Z0-9]+)(?:\/creative\/(CR[A-Z0-9]+))?(?:\?[^#]*region=([A-Z]{2}))?/;

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json(
      { error: "url required" },
      { status: 400 }
    );
  }
  const m = url.match(URL_RE);
  if (!m) {
    return NextResponse.json(
      {
        error:
          "URL 형식 인식 실패. ATC creative 또는 advertiser URL이어야 함 (예: https://adstransparency.google.com/advertiser/ARxxx/creative/CRyyy?region=KR).",
      },
      { status: 400 }
    );
  }
  const advertiserId = m[1];
  const creativeId = m[2] ?? null;
  const region = m[3] ?? "KR";

  // === Path 1: advertiser-only URL → run full advertiser scrape ===
  if (!creativeId) {
    try {
      const ads = await getAdsForAdvertisers(
        [advertiserId],
        region,
        40,
        20
      );
      let saved = 0;
      for (const a of ads) {
        const existing = await prisma.ad.findUnique({
          where: { creativeId: a.creativeId },
        });
        if (existing) continue;
        await prisma.ad
          .create({
            data: {
              advertiserId: a.advertiserId,
              advertiserName: a.advertiserName,
              creativeId: a.creativeId,
              type: a.type,
              region,
              firstSeen: a.firstSeen,
              lastSeen: a.lastSeen,
              previewUrl: a.previewUrl ?? null,
              imageHtml: a.imageHtml ?? null,
              keyword: `url:${advertiserId}`,
            },
          })
          .catch(() => {});
        saved += 1;
      }
      return NextResponse.json({
        ok: true,
        mode: "advertiser-scan",
        advertiserId,
        region,
        adsFromAtc: ads.length,
        adsNewlySaved: saved,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "advertiser scrape failed" },
        { status: 500 }
      );
    }
  }

  // === Path 2: specific creative URL → Playwright fetch + save ===
  // Try the URL first as user gave it, then fallback to other regions
  // (광고가 KR에서는 빠졌지만 US/JP에 살아있는 경우 종종 있음).
  const tryRegions = [region, "US", "JP", "GB"];
  const seen = new Set<string>();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const r of tryRegions) {
      if (seen.has(r)) continue;
      seen.add(r);
      const probeUrl = `https://adstransparency.google.com/advertiser/${advertiserId}/creative/${creativeId}?region=${r}`;
      const ctx = await browser.newContext({
        locale: "ko-KR",
        viewport: { width: 1366, height: 900 },
      });
      try {
        const page = await ctx.newPage();
        await page.goto(probeUrl, {
          waitUntil: "domcontentloaded",
          timeout: 25000,
        });
        await page.waitForTimeout(4000);
        const text = await page.evaluate(() => document.body.innerText);
        const notFound =
          text.includes("광고를 찾을 수 없음") ||
          text.includes("not be found") ||
          text.length < 300;
        if (notFound) {
          continue; // try next region
        }
        // Found — try to extract advertiser name + creative type from
        // the page. We rely on body text patterns since ATC doesn't
        // expose a public JSON API for single creatives.
        const advertiserName =
          text.match(/법적 이름:\s*([^\n]+)/)?.[1]?.trim() ||
          text.match(/^(.+?)$/m)?.[1]?.trim() ||
          advertiserId;
        // Persist (or update) the row.
        const existing = await prisma.ad.findUnique({
          where: { creativeId },
        });
        if (existing) {
          return NextResponse.json({
            ok: true,
            mode: "single-creative",
            alreadyExists: true,
            creativeId,
            region: r,
            advertiserName: existing.advertiserName,
          });
        }
        await prisma.ad.create({
          data: {
            advertiserId,
            advertiserName,
            creativeId,
            type: "other",
            region: r,
            firstSeen: null,
            lastSeen: null,
            previewUrl: null,
            imageHtml: null,
            keyword: `url:${advertiserId}`,
          },
        });
        return NextResponse.json({
          ok: true,
          mode: "single-creative",
          newlySaved: true,
          creativeId,
          region: r,
          advertiserName,
        });
      } finally {
        await ctx.close().catch(() => {});
      }
    }
    // None of the regions had it.
    return NextResponse.json(
      {
        ok: false,
        error: "creative-not-in-atc",
        message:
          "이 광고는 ATC에서 모든 region에서 제거된 상태예요. 광고주가 종료했거나 정책 위반으로 차단된 경우. 복구 불가.",
        triedRegions: tryRegions,
        advertiserId,
        creativeId,
      },
      { status: 404 }
    );
  } finally {
    await browser.close().catch(() => {});
  }
}
