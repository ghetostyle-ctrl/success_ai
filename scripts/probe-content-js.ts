import { spawn } from "node:child_process";

function curlGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cp = spawn("curl", ["-s", "-A", "Mozilla/5.0", "--max-time", "20", url]);
    let out = "";
    cp.stdout.on("data", (d) => (out += d.toString()));
    cp.on("close", (c) => (c === 0 ? resolve(out) : reject(new Error(`curl ${c}`))));
  });
}

async function main() {
  const url = "https://displayads-formats.googleusercontent.com/ads/preview/content.js?client=ads-integrity-transparency&obfuscatedCustomerId=1634394367&creativeId=803570145560&uiFeatures=12,54&adGroupId=198727107087&assets=%3DH4sIAAAAAAAAAOPS4eLk6G6ae7KNS4CRi5Nj2c7VbW1cAmxcnByz73493sYlwMrFyXH07Nd9LzkFmAEJc8HVLgAAAA&sig=ACiVB_xWDM7rieIeZmmFgWRlqtuT1jZd9Q&htmlParentId=fletch-render-12170803561308340461&responseCallback=fletchCallback12170803561308340461";
  console.log("Fetching content.js for video ad CR06000458135901306881…");
  const html = await curlGet(url);
  console.log(`response size: ${html.length} bytes`);
  
  // Search for YouTube patterns
  const patterns = [
    /([A-Za-z0-9_-]{11})/g,
    /youtu\.be\/([A-Za-z0-9_-]{11})/g,
    /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/g,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/g,
    /\/vi\/([A-Za-z0-9_-]{11})\//g,
  ];
  for (const p of patterns) {
    const matches = [...html.matchAll(p)];
    if (matches.length > 0) {
      console.log(`  pattern ${p}: ${matches.length} matches`);
    }
  }
  
  // Direct YouTube keyword search
  console.log("\n=== youtube/youtu.be mentions ===");
  const mentions = html.match(/.{0,30}(youtube|youtu\.be|ytimg).{0,80}/gi);
  if (mentions) {
    mentions.slice(0, 8).forEach(m => console.log("  ", m));
  } else {
    console.log("  (none)");
  }
  
  // Look for video URLs in general
  console.log("\n=== video/mp4/m3u8 URLs ===");
  const videos = html.match(/https?:\/\/[^"'\s]+\.(mp4|m3u8|webm)[^"'\s]*/g);
  if (videos) {
    videos.slice(0, 5).forEach(v => console.log("  ", v.slice(0, 120)));
  } else {
    console.log("  (none)");
  }
  
  // First 800 chars of response
  console.log("\n=== response head (first 800 chars) ===");
  console.log(html.slice(0, 800));
}
main().catch(e => { console.error(e); process.exit(1); });
