export type ReferencePlatform = "meta" | "google";
export type ReferenceSelection = {
  readonly platform: ReferencePlatform;
} & ({ readonly mode: "ids"; readonly ids: readonly string[] }
  | { readonly mode: "keyword"; readonly keyword: string; readonly limit: number });

export type ReferenceObservation = {
  readonly name: "delivery_start" | "delivery_stop" | "first_seen" | "last_seen"
    | "creative_variant_count" | "public_views" | "public_likes" | "public_comments" | "published_at";
  readonly value: string | number;
  readonly observedAt: string | null;
  readonly source: "meta_ad_library" | "google_ads_transparency" | "youtube_public";
};

export type ReferenceData = {
  readonly platform: ReferencePlatform;
  readonly brand: string;
  readonly headlines: readonly string[];
  readonly bodies: readonly string[];
  readonly transcriptSegments: readonly {
    readonly startSec: number;
    readonly endSec: number;
    readonly text: string;
    readonly provenance: "whisper";
  }[];
  readonly media: readonly { readonly kind: "image" | "video" | "preview"; readonly url: string }[];
  readonly observations: readonly ReferenceObservation[];
};

export type ExportedReference = {
  readonly kind: "reference";
  readonly title: string;
  readonly content: string;
  readonly url: string;
  readonly evidence: "observed";
  readonly status: "eligible";
  readonly expiresAt: null;
  readonly provenance: {
    readonly origin: "success_ai";
    readonly externalId: string;
    readonly capturedAt: string;
    readonly author: null;
  };
  readonly referenceData: ReferenceData;
};

export class ReferenceExportError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 413 | 422) {
    super(message);
    this.name = "ReferenceExportError";
  }
}

export function parseReferenceSelection(params: URLSearchParams): ReferenceSelection {
  const platform = params.get("platform");
  const keys = [...params.keys()];
  if ((platform !== "meta" && platform !== "google") || keys.length !== new Set(keys).size
    || keys.some((key) => !["platform", "ids", "keyword", "limit"].includes(key))) {
    throw new ReferenceExportError("Use platform=meta|google with either IDs or an exact saved keyword.", 400);
  }
  if (params.has("keyword")) {
    const keyword = params.get("keyword")?.trim() ?? "";
    const rawLimit = params.get("limit") ?? "20";
    const limit = Number(rawLimit);
    if (params.has("ids") || keyword.length < 1 || keyword.length > 240
      || !/^\d+$/.test(rawLimit) || limit < 1 || limit > 100) {
      throw new ReferenceExportError("Use an exact saved keyword and a limit from 1 to 100.", 400);
    }
    return { platform, mode: "keyword", keyword, limit };
  }
  const ids = params.get("ids")?.split(",").map((id) => id.trim()) ?? [];
  if (params.has("limit") || ids.length < 1 || ids.length > 100
    || ids.some((id) => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) {
    throw new ReferenceExportError("Use platform=meta|google and 1–100 comma-separated archive/creative IDs.", 400);
  }
  return { platform, mode: "ids", ids: [...new Set(ids)] };
}
