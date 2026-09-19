/**
 * Quick smoke test for the new direct HTTP extractor.
 * Fetches a few example.co.kr ad detail pages (via SearchCreatives RPC),
 * then extracts from each in parallel. Verifies it actually works
 * before we wire it into the pipeline.
 */
import { extractAdInfoDirect } from "../src/lib/yt-extractor-direct";
import { execFileSync } from "node:child_process";

async function main() {
  console.log("Fetching example.co.kr ads via RPC (curl)...");

  const t0 = Date.now();
  const body =
    "f.req=" +
    encodeURIComponent(
      JSON.stringify({
        "2": 40,
        "3": {
          "8": [2410],
          "12": { "1": "example.co.kr", "2": true },
        },
        "7": { "1": 1, "2": 0, "3": 2410 },
      })
    );
  const out = execFileSync(
    "curl",
    [
      "-s",
      "-X",
      "POST",
      "https://adstransparency.google.com/anji/_/rpc/SearchService/SearchCreatives?authuser=",
      "-H",
      "content-type: application/x-www-form-urlencoded",
      "-H",
      "x-same-domain: 1",
      "-H",
      "referer: https://adstransparency.google.com/?region=KR",
      "--data-raw",
      body,
    ],
    { encoding: "utf8" }
  );
  const data = JSON.parse(out) as { "1"?: Array<Record<string, unknown>> };
  const rawAds = (data["1"] ?? []) as Array<{
    "1": string;
    "2": string;
    "3"?: { "1"?: { "4"?: string } };
    "4"?: number;
  }>;

  // Take video/other ads with a content.js URL
  const ads = rawAds
    .filter((a) => (a["4"] === 2 || a["4"] === 3) && a["3"]?.["1"]?.["4"])
    .map((a) => ({
      advertiserId: a["1"],
      creativeId: a["2"],
      previewUrl: a["3"]!["1"]!["4"]!,
    }));

  console.log(`Got ${ads.length} ads with content.js URLs`);

  const tExtract0 = Date.now();
  const result = await extractAdInfoDirect(ads, {
    concurrency: 8,
    onProgress: (done, total, yt, img) => {
      if (done % 5 === 0 || done === total) {
        console.log(`  [${done}/${total}] yt=${yt} img=${img}`);
      }
    },
  });
  const dt = ((Date.now() - tExtract0) / 1000).toFixed(1);

  console.log(`\nExtracted ${result.size} ads in ${dt}s`);

  let yt = 0,
    img = 0,
    txt = 0;
  for (const v of result.values()) {
    if (v.youtubeId) yt++;
    if (v.previewImage) img++;
    if (v.adHeadline || v.adLongHeadline || v.adDescription) txt++;
  }
  console.log(
    `Stats: youtube=${yt}/${result.size}, image=${img}/${result.size}, text=${txt}/${result.size}`
  );

  console.log("\nSample matches:");
  let i = 0;
  for (const [creativeId, v] of result) {
    if (i >= 5) break;
    console.log(`  ${creativeId.slice(-8)}:`);
    if (v.youtubeId) console.log(`    yt = https://youtu.be/${v.youtubeId}`);
    if (v.adHeadline) console.log(`    headline = ${v.adHeadline.slice(0, 60)}`);
    if (v.adLongHeadline)
      console.log(`    long = ${v.adLongHeadline.slice(0, 60)}`);
    if (v.adDescription)
      console.log(`    desc = ${v.adDescription.slice(0, 60)}`);
    i++;
  }

  console.log(`\nTotal wall: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
