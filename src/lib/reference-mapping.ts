import type { Ad, DissectionRow, MetaAd } from "@/generated/prisma/client";
import type { ExportedReference, ReferenceData, ReferenceObservation } from "./reference-types";
import { ReferenceExportError } from "./reference-types";

export function parseStoredCopy(stored: string | null): readonly string[] {
  if (stored === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    if (error instanceof SyntaxError) throw new ReferenceExportError("Stored creative copy is malformed.", 422);
    throw error;
  }
  if (!Array.isArray(parsed) || !parsed.every((item): item is string => typeof item === "string")) {
    throw new ReferenceExportError("Stored creative copy must contain strings.", 422);
  }
  return [...new Set(parsed.filter((text) => text.trim().length > 0))];
}

export function referenceContent(data: Pick<ReferenceData, "headlines" | "bodies" | "transcriptSegments">): string {
  const content = [...new Set([...data.headlines, ...data.bodies,
    ...data.transcriptSegments.map((segment) => segment.text)])].join("\n\n");
  if (content.length > 20_000) throw new ReferenceExportError("Captured reference content exceeds the import limit.", 413);
  return content;
}

function mediaLink(kind: ReferenceData["media"][number]["kind"], value: string | null): ReferenceData["media"] {
  if (!value || !URL.canParse(value)) return [];
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return [];
  return [{ kind, url: value }];
}

export function transcriptSegments(rows: readonly Pick<DissectionRow, "startSec" | "endSec" | "script">[]): ReferenceData["transcriptSegments"] {
  if (rows.length > 500) throw new ReferenceExportError("Captured transcript exceeds 500 segments.", 413);
  return rows.filter((row) => row.script.trim().length > 0).map((row) => {
    if (!Number.isFinite(row.startSec) || !Number.isFinite(row.endSec)
      || row.startSec < 0 || row.endSec < row.startSec) {
      throw new ReferenceExportError("Stored transcript timing is invalid.", 422);
    }
    return { startSec: row.startSec, endSec: row.endSec, text: row.script, provenance: "whisper" };
  });
}

function observation(
  details: Omit<ReferenceObservation, "value">,
  value: string | number | null,
): readonly ReferenceObservation[] {
  return value === null ? [] : [{ ...details, value }];
}

function exportedReference(
  identity: { readonly id: string; readonly title: string; readonly url: string; readonly capturedAt: Date },
  referenceData: ReferenceData,
): ExportedReference {
  if (referenceData.headlines.length > 100 || referenceData.bodies.length > 100
    || referenceData.transcriptSegments.length > 500 || referenceData.brand.length > 500
    || referenceData.headlines.some((text) => text.length > 10_000)
    || referenceData.bodies.some((text) => text.length > 50_000)
    || referenceData.transcriptSegments.some((segment) => segment.text.length > 10_000)
    || referenceData.media.some((media) => media.url.length > 8_192)
    || referenceData.observations.some((item) => typeof item.value === "string" && item.value.length > 1_000)
    || identity.url.length > 4_000) {
    throw new ReferenceExportError("Captured reference exceeds the import record limit.", 413);
  }
  return {
    kind: "reference", title: identity.title.slice(0, 240), content: referenceContent(referenceData),
    url: identity.url, evidence: "observed", status: "eligible", expiresAt: null,
    provenance: { origin: "success_ai", externalId: `${referenceData.platform}:${identity.id}`,
      capturedAt: identity.capturedAt.toISOString(), author: null },
    referenceData,
  };
}

export function mapMetaReference(ad: MetaAd, transcript: ReferenceData["transcriptSegments"]): ExportedReference {
  const headlines = parseStoredCopy(ad.linkTitles);
  const bodies = [...parseStoredCopy(ad.bodies), ...parseStoredCopy(ad.linkDescriptions)];
  const capturedAt = ad.updatedAt.toISOString();
  const observations = [
    ...observation({ name: "delivery_start", observedAt: capturedAt, source: "meta_ad_library" }, ad.startTime),
    ...observation({ name: "delivery_stop", observedAt: capturedAt, source: "meta_ad_library" }, ad.stopTime),
    ...observation({ name: "creative_variant_count", observedAt: ad.librarySignalsFetchedAt?.toISOString() ?? null,
      source: "meta_ad_library" }, ad.metaVariantCount),
  ];
  return exportedReference({ id: ad.adArchiveId, title: `${ad.pageName} · ${headlines[0] ?? ad.adArchiveId}`,
    url: `https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.adArchiveId)}`, capturedAt: ad.updatedAt }, {
    platform: "meta", brand: ad.pageName, headlines, bodies, transcriptSegments: transcript,
    media: [...mediaLink("image", ad.mediaUrl), ...mediaLink("preview", ad.snapshotUrl)],
    observations,
  });
}

export function mapGoogleReference(ad: Ad, transcript: ReferenceData["transcriptSegments"], latestStoredAt = ad.updatedAt): ExportedReference {
  const headlines = [ad.adHeadline, ad.adLongHeadline].filter((text): text is string => Boolean(text?.trim()));
  const bodies = ad.adDescription ? [ad.adDescription] : [];
  const capturedAt = ad.updatedAt.toISOString();
  const youtubeObservedAt = ad.ytFetchedAt?.toISOString() ?? null;
  const observations = [
    ...observation({ name: "first_seen", observedAt: capturedAt, source: "google_ads_transparency" }, ad.firstSeen),
    ...observation({ name: "last_seen", observedAt: capturedAt, source: "google_ads_transparency" }, ad.lastSeen),
    ...observation({ name: "public_views", observedAt: youtubeObservedAt, source: "youtube_public" }, ad.ytViews),
    ...observation({ name: "public_likes", observedAt: youtubeObservedAt, source: "youtube_public" }, ad.ytLikes),
    ...observation({ name: "public_comments", observedAt: youtubeObservedAt, source: "youtube_public" }, ad.ytComments),
    ...observation({ name: "published_at", observedAt: youtubeObservedAt, source: "youtube_public" }, ad.ytPublishedAt),
  ];
  return exportedReference({ id: ad.creativeId, title: `${ad.advertiserName} · ${headlines[0] ?? ad.ytTitle ?? ad.creativeId}`,
    url: `https://adstransparency.google.com/advertiser/${encodeURIComponent(ad.advertiserId)}/creative/${encodeURIComponent(ad.creativeId)}?region=${encodeURIComponent(ad.region)}`,
    capturedAt: latestStoredAt }, {
    platform: "google", brand: ad.advertiserName, headlines, bodies, transcriptSegments: transcript,
    media: [...mediaLink("image", ad.previewImage), ...mediaLink("preview", ad.previewUrl),
      ...mediaLink("video", ad.youtubeId ? `https://www.youtube.com/watch?v=${encodeURIComponent(ad.youtubeId)}` : null)],
    observations,
  });
}
