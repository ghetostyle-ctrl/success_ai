import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReferenceSelection, ReferenceExportError } from "./reference-types";
import { parseStoredCopy, referenceContent } from "./reference-mapping";

test("selection rejects an unbounded request when IDs are absent", () => {
  // Given
  const query = new URLSearchParams("platform=meta");
  // When
  const exporting = () => parseReferenceSelection(query);
  // Then
  assert.throws(exporting, ReferenceExportError);
});

test("selection preserves chosen order when IDs repeat", () => {
  // Given
  const query = new URLSearchParams("platform=google&ids=CR2,CR1,CR2");
  // When
  const selected = parseReferenceSelection(query);
  // Then
  assert.deepEqual(selected, { platform: "google", mode: "ids", ids: ["CR2", "CR1"] });
});

test("selection rejects oversized and unexpected input when exporting", () => {
  // Given
  const queries = ["platform=meta&ids=1&all=true", "platform=other&ids=1",
    "platform=meta&ids=1,,2", `platform=meta&ids=${Array.from({ length: 101 }, (_, i) => i).join(",")}`];
  // When
  const exporting = queries.map((query) => () => parseReferenceSelection(new URLSearchParams(query)));
  // Then
  for (const run of exporting) assert.throws(run, ReferenceExportError);
});

test("copy parsing preserves actual text when JSON contains valid strings", () => {
  // Given
  const stored = JSON.stringify(["실제 광고 문구", "실제 광고 문구", "두 번째 카피"]);
  // When
  const copy = parseStoredCopy(stored);
  // Then
  assert.deepEqual(copy, ["실제 광고 문구", "두 번째 카피"]);
});

test("keyword selection defaults to twenty exact-match records when limit is omitted", () => {
  // Given
  const query = new URLSearchParams("platform=meta&keyword=brand.example");
  // When
  const selection = parseReferenceSelection(query);
  // Then
  assert.deepEqual(selection, { platform: "meta", mode: "keyword", keyword: "brand.example", limit: 20 });
});

test("keyword selection rejects ambiguous or unbounded queries when parameters conflict", () => {
  // Given
  const queries = ["platform=meta&keyword=brand&ids=1", "platform=meta&keyword=brand&limit=101",
    "platform=meta&keyword=brand&limit=0", "platform=meta&keyword=brand&keyword=other"];
  // When
  const exporting = queries.map((query) => () => parseReferenceSelection(new URLSearchParams(query)));
  // Then
  for (const run of exporting) assert.throws(run, ReferenceExportError);
});

test("copy parsing rejects malformed fields instead of inventing content", () => {
  // Given
  const malformed = ["broken JSON", '{"views":123}', '[123]'];
  // When
  const parsing = malformed.map((stored) => () => parseStoredCopy(stored));
  // Then
  for (const run of parsing) assert.throws(run, ReferenceExportError);
});

test("reference content remains empty when only metadata is available", () => {
  // Given
  const captured = { headlines: [], bodies: [], transcriptSegments: [] };
  // When
  const content = referenceContent(captured);
  // Then
  assert.equal(content, "");
});

test("reference content uses captured copy and transcript without performance assertions", () => {
  // Given
  const captured = { headlines: ["실제 제목"], bodies: ["실제 본문"],
    transcriptSegments: [{ startSec: 0, endSec: 2, text: "실제 음성", provenance: "whisper" as const }] };
  // When
  const content = referenceContent(captured);
  // Then
  assert.equal(content, "실제 제목\n\n실제 본문\n\n실제 음성");
});
