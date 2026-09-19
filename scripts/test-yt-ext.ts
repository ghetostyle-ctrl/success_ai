import { extractYouTubeIdsFromATC } from "../src/lib/yt-extractor";

async function main() {
  const query = process.argv[2] ?? "example.co.kr";
  const wait = parseInt(process.argv[3] ?? "25000", 10);
  console.log(`Extracting YouTube IDs for "${query}" (wait=${wait}ms)...`);
  const t0 = Date.now();
  const ids = await extractYouTubeIdsFromATC(query, { waitMs: wait });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Got ${ids.length} unique YouTube IDs in ${dt}s:`);
  for (const id of ids.slice(0, 30)) {
    console.log(`  https://youtu.be/${id.youtubeId}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
