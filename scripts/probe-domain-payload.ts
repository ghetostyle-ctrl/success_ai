// Direct ATC RPC call with various payload tweaks to find the one
// that returns ALL ads (incl. inactive) for a domain.
import { spawn } from "node:child_process";

function curlPost(url: string, body: string, headers: Record<string,string>) {
  return new Promise<{status:number;body:string}>((resolve, reject) => {
    const args = ["-s","-X","POST","-w","\n__HTTP_STATUS__%{http_code}","--connect-timeout","10","--max-time","30",url,"--data-raw",body];
    for (const [k,v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
    const cp = spawn("curl", args);
    let out=""; let err="";
    cp.stdout.on("data", d=>out+=d.toString());
    cp.stderr.on("data", d=>err+=d.toString());
    cp.on("close", code => {
      if (code !== 0) return reject(new Error(`curl ${code}: ${err}`));
      const m = out.match(/\n__HTTP_STATUS__(\d+)$/);
      const status = m ? parseInt(m[1]) : 0;
      const responseBody = m ? out.slice(0, m.index!) : out;
      resolve({status, body: responseBody});
    });
  });
}

async function search(payload: Record<string, unknown>, label: string) {
  const url = "https://adstransparency.google.com/anji/_/rpc/SearchService/SearchCreatives?authuser=";
  const body = `f.req=${encodeURIComponent(JSON.stringify(payload))}`;
  const headers = {
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "x-same-domain": "1",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };
  try {
    const r = await curlPost(url, body, headers);
    if (r.status !== 200) { console.log(`  [${label}] HTTP ${r.status}`); return 0; }
    // Strip the JSON safety prefix `)]}'`
    const cleaned = r.body.replace(/^\)\]\}'\n?/, "");
    const data = JSON.parse(cleaned);
    const ads = data["1"] ?? [];
    console.log(`  [${label}] ads: ${ads.length}`);
    return ads.length;
  } catch (e) {
    console.log(`  [${label}] error: ${e instanceof Error ? e.message : "?"}`);
    return 0;
  }
}

async function main() {
  const domain = "example-shop.com";
  const code = "KR";
  
  console.log("=== payload variations ===");
  // baseline (current) — "12": { "1": domain, "2": true }
  await search({
    "2": 40,
    "3": { "8": [code], "12": { "1": domain, "2": true } },
    "7": { "1": 1, "2": 0, "3": code },
  }, "current (12.2=true)");
  
  // try "2": false
  await search({
    "2": 40,
    "3": { "8": [code], "12": { "1": domain, "2": false } },
    "7": { "1": 1, "2": 0, "3": code },
  }, "12.2=false");
  
  // omit "12.2"
  await search({
    "2": 40,
    "3": { "8": [code], "12": { "1": domain } },
    "7": { "1": 1, "2": 0, "3": code },
  }, "12.2=omit");
  
  // try "7": active false
  await search({
    "2": 40,
    "3": { "8": [code], "12": { "1": domain, "2": true } },
    "7": { "1": 0, "2": 0, "3": code },
  }, "7.1=0");
  
  // try removing "7" filter
  await search({
    "2": 40,
    "3": { "8": [code], "12": { "1": domain, "2": true } },
  }, "no 7");
  
  // Try "3.4": {} (active_status filter)
  await search({
    "2": 40,
    "3": { "8": [code], "12": { "1": domain, "2": true }, "4": [] },
    "7": { "1": 1, "2": 0, "3": code },
  }, "3.4=[]");
  
  // larger pageSize
  await search({
    "2": 200,
    "3": { "8": [code], "12": { "1": domain, "2": true } },
    "7": { "1": 1, "2": 0, "3": code },
  }, "pageSize=200");
}
main();
