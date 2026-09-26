import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { exportSelectedReferences } from "./reference-export";
import { ReferenceExportError } from "./reference-types";

async function withFixture(run: (client: PrismaClient) => Promise<void>) {
  const fixturePrefix = path.join(tmpdir(), "success-ai-reference-test-");
  const directory = await mkdtemp(fixturePrefix);
  const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path.join(directory, "fixture.db")}` }) });
  try {
    const schema = await readFile(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    for (const model of schema.matchAll(/^model (Ad|MetaAd|Dissection|DissectionRow) \{([\s\S]*?)^\}/gm)) {
      const fields = [...(model[2] ?? "").matchAll(/^\s+(\w+)\s+(String|Int|Float|Boolean|DateTime)\??\s/gm)];
      const columns = fields.map((field) => `"${field[1]}" ${field[2] === "String" ? "TEXT" : field[2] === "DateTime" ? "DATETIME" : "NUMERIC"}`);
      await client.$executeRawUnsafe(`CREATE TABLE "${model[1]}" (${columns.join(", ")})`);
    }
    await run(client);
  } finally {
    await client.$disconnect();
    if (path.resolve(directory).startsWith(path.resolve(fixturePrefix))) await rm(directory, { recursive: true });
  }
}

test("exact brand export reads only its bounded ordered records from SQLite", async () => {
  await withFixture(async (client) => {
    // Given
    const timestamp = new Date("2026-09-24T00:00:00.000Z");
    for (const [id, keyword] of [["2", "brand"], ["1", "brand"], ["3", "brand-other"]]) {
      await client.metaAd.create({ data: { adArchiveId: id, keyword, pageId: "page", pageName: "Reference brand",
        savedAt: timestamp, updatedAt: timestamp, bodies: '["Captured body"]', resolvedYoutubeId: "landingvideo" } });
    }
    // When
    const exported = await exportSelectedReferences(client, { platform: "meta", mode: "keyword", keyword: "brand", limit: 1 });
    // Then
    assert.deepEqual(exported.items.map((item) => item.provenance.externalId), ["meta:1"]);
    assert.equal(exported.items[0]?.content, "Captured body");
    assert.deepEqual(exported.items[0]?.referenceData.media, []);
    assert.deepEqual(exported.items[0]?.referenceData.transcriptSegments, []);
  });
});

test("missing selected IDs fail the batch instead of silently exporting partial records", async () => {
  await withFixture(async (client) => {
    // Given
    const selection = { platform: "meta", mode: "ids", ids: ["missing"] } as const;
    // When
    const exporting = exportSelectedReferences(client, selection);
    // Then
    await assert.rejects(exporting, ReferenceExportError);
  });
});

test("Meta export keeps both creative image and captured video link", async () => {
  await withFixture(async (client) => {
    const timestamp = new Date("2026-09-24T00:00:00.000Z");
    await client.metaAd.create({ data: { adArchiveId: "video-1", keyword: "brand", pageId: "page",
      pageName: "Brand", savedAt: timestamp, updatedAt: timestamp,
      mediaUrl: "https://scontent.example.fbcdn.net/poster.jpg",
      videoUrl: "https://video.example.fbcdn.net/creative.mp4" } });
    const exported = await exportSelectedReferences(client, { platform: "meta", mode: "ids", ids: ["video-1"] });
    assert.deepEqual(exported.items[0]?.referenceData.media, [
      { kind: "image", url: "https://scontent.example.fbcdn.net/poster.jpg" },
      { kind: "video", url: "https://video.example.fbcdn.net/creative.mp4" },
    ]);
  });
});

test("Google exports existing completed creative transcript and public observation provenance", async () => {
  await withFixture(async (client) => {
    // Given
    const timestamp = new Date("2026-09-24T00:00:00.000Z");
    await client.ad.create({ data: { creativeId: "CR1", advertiserId: "AR1", advertiserName: "Reference brand",
      type: "video", keyword: "brand", region: "KR", savedAt: timestamp, updatedAt: timestamp, ytViews: 123,
      ytFetchedAt: timestamp, youtubeId: "video123456", ytTitle: "Metadata title" } });
    await client.dissection.create({ data: { url: "https://www.youtube.com/watch?v=video123456", adCreativeId: "CR1",
      status: "complete", createdAt: timestamp, updatedAt: timestamp, rows: { create: [
        { seq: 1, startSec: 0, endSec: 2, script: "Captured speech", shotType: "video" },
      ] } } });
    // When
    const exported = await exportSelectedReferences(client, { platform: "google", mode: "ids", ids: ["CR1"] });
    // Then
    assert.equal(exported.items[0]?.content, "Captured speech");
    assert.deepEqual(exported.items[0]?.referenceData.observations, [
      { name: "public_views", value: 123, observedAt: timestamp.toISOString(), source: "youtube_public" },
    ]);
    assert.deepEqual(exported.items[0]?.referenceData.transcriptSegments, [
      { startSec: 0, endSec: 2, text: "Captured speech", provenance: "whisper" },
    ]);
  });
});

test("Google export includes the stored image creative when previewImage is absent", async () => {
  await withFixture(async (client) => {
    const timestamp = new Date("2026-09-24T00:00:00.000Z");
    await client.ad.create({ data: { creativeId: "IMAGE1", advertiserId: "AR1", advertiserName: "Reference brand",
      type: "image", keyword: "brand", region: "KR", savedAt: timestamp, updatedAt: timestamp,
      imageHtml: '<img src="https://tpc.googlesyndication.com/archive/simgad/123456">' } });
    const exported = await exportSelectedReferences(client, { platform: "google", mode: "ids", ids: ["IMAGE1"] });
    assert.deepEqual(exported.items[0]?.referenceData.media, [
      { kind: "image", url: "https://tpc.googlesyndication.com/archive/simgad/123456" },
    ]);
  });
});

test("export rejects captured fields beyond the consumer contract before returning a payload", async () => {
  await withFixture(async (client) => {
    // Given
    const timestamp = new Date("2026-09-24T00:00:00.000Z");
    await client.metaAd.create({ data: { adArchiveId: "1", keyword: "brand", pageId: "page", pageName: "Brand",
      savedAt: timestamp, updatedAt: timestamp, linkTitles: JSON.stringify(["x".repeat(10_001)]) } });
    // When
    const exporting = exportSelectedReferences(client, { platform: "meta", mode: "ids", ids: ["1"] });
    // Then
    await assert.rejects(exporting, (error: unknown) => error instanceof ReferenceExportError && error.status === 413);
  });
});
