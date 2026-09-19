/**
 * Capture the actual JSON response bodies from ATC's SearchService RPC calls.
 * Run: npx tsx scripts/capture-atc-rpc.ts <query>
 */
import { chromium } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";

const QUERY = process.argv[2] ?? "쿠팡";
const REGION = process.argv[3] ?? "KR";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  const captures: { name: string; status: number; body: string }[] = [];

  page.on("response", async (res) => {
    const url = res.url();
    const m = url.match(/\/rpc\/SearchService\/(\w+)/);
    if (!m) return;
    try {
      const body = await res.text();
      captures.push({ name: m[1], status: res.status(), body });
    } catch (e) {
      // body retrieval can fail for some responses
    }
  });

  console.log(`→ navigating with query=${QUERY}`);
  await page.goto(`https://adstransparency.google.com/?region=${REGION}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2500);

  console.log(`→ typing query`);
  const input = page.locator("input").first();
  await input.click();
  await input.fill(QUERY);
  await page.waitForTimeout(2500);

  console.log(`→ clicking first suggestion`);
  const firstSug = page.locator('[role="option"]').first();
  if (await firstSug.count()) {
    await firstSug.click();
    await page.waitForTimeout(6000);
  } else {
    console.log("  no suggestions, pressing Enter");
    await input.press("Enter");
    await page.waitForTimeout(6000);
  }

  // scroll to load more results
  await page.evaluate(() => window.scrollBy(0, 2000));
  await page.waitForTimeout(2000);

  await browser.close();

  const outDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n=== ${captures.length} RPC responses captured ===`);
  captures.forEach((c, i) => {
    console.log(`[${i}] ${c.name} status=${c.status} bytes=${c.body.length}`);
    fs.writeFileSync(
      path.join(outDir, `rpc-${i}-${c.name}.json`),
      c.body
    );
  });
  console.log(`✓ saved bodies to tmp/rpc-*.json`);

  // Print preview of first SearchCreatives body
  const sc = captures.find((c) => c.name === "SearchCreatives");
  if (sc) {
    console.log("\n=== SearchCreatives body preview ===");
    // ATC uses a "])}'\n" XSSI prefix on JSON. Strip it.
    const cleaned = sc.body.replace(/^\)]\}'\n?/, "");
    try {
      const json = JSON.parse(cleaned);
      console.log(JSON.stringify(json, null, 2).slice(0, 4000));
    } catch (e) {
      console.log("  failed to parse, raw preview:");
      console.log(cleaned.slice(0, 2000));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
