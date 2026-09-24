import type { PrismaClient } from "@/generated/prisma/client";
import { mapGoogleReference, mapMetaReference, transcriptSegments } from "./reference-mapping";
import type { ExportedReference, ReferenceSelection } from "./reference-types";
import { ReferenceExportError } from "./reference-types";

function assertNever(value: never): never {
  throw new TypeError(`Unsupported reference variant: ${String(value)}`);
}

function readMeta(client: PrismaClient, selection: ReferenceSelection) {
  switch (selection.mode) {
    case "ids":
      return client.metaAd.findMany({ where: { adArchiveId: { in: [...selection.ids] } } });
    case "keyword":
      return client.metaAd.findMany({ where: { keyword: selection.keyword }, take: selection.limit,
        orderBy: [{ updatedAt: "desc" }, { adArchiveId: "asc" }] });
    default:
      return assertNever(selection);
  }
}

function readGoogle(client: PrismaClient, selection: ReferenceSelection) {
  switch (selection.mode) {
    case "ids":
      return client.ad.findMany({ where: { creativeId: { in: [...selection.ids] } } });
    case "keyword":
      return client.ad.findMany({ where: { keyword: selection.keyword }, take: selection.limit,
        orderBy: [{ updatedAt: "desc" }, { creativeId: "asc" }] });
    default:
      return assertNever(selection);
  }
}

export async function exportSelectedReferences(client: PrismaClient, selection: ReferenceSelection) {
  let items: readonly ExportedReference[];
  switch (selection.platform) {
    case "meta":
      items = (await readMeta(client, selection)).map((ad) => mapMetaReference(ad, []));
      break;
    case "google":
      items = await Promise.all((await readGoogle(client, selection)).map(async (ad) => {
        const dissection = await client.dissection.findFirst({
          where: { status: "complete", OR: [
            { adCreativeId: ad.creativeId },
            ...(ad.youtubeId ? [{ youtubeId: ad.youtubeId }] : []),
          ] },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          select: { updatedAt: true, rows: { orderBy: { seq: "asc" }, take: 501,
            select: { startSec: true, endSec: true, script: true } } },
        });
        const latestStoredAt = new Date(Math.max(ad.updatedAt.getTime(), dissection?.updatedAt.getTime() ?? 0));
        return mapGoogleReference(ad, transcriptSegments(dissection?.rows ?? []), latestStoredAt);
      }));
      break;
    default:
      return assertNever(selection.platform);
  }
  if (items.length === 0) throw new ReferenceExportError("No stored references match this selection.", 404);
  switch (selection.mode) {
    case "ids": {
      if (items.length !== selection.ids.length) throw new ReferenceExportError("One or more selected references were not found.", 404);
      const order = new Map(selection.ids.map((id, index) => [`${selection.platform}:${id}`, index]));
      items = [...items].sort((left, right) => (order.get(left.provenance.externalId) ?? 0) - (order.get(right.provenance.externalId) ?? 0));
      break;
    }
    case "keyword":
      break;
    default:
      return assertNever(selection);
  }
  const payload = { schemaVersion: 1, exportedAt: new Date().toISOString(), items };
  if (JSON.stringify(payload).length > 500_000) throw new ReferenceExportError("Export exceeds 500,000 characters. Select fewer references.", 413);
  return payload;
}
