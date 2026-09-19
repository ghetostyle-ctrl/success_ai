/**
 * IPRoyal 잔여 트래픽 자동 체크 + Slack 알림.
 *
 * 사용자가 잔량을 "안 물어봐도" 알 수 있게 — run-tracked.ts cron(매일
 * 새벽 3시) 시작 시 호출되어 매일 실행된다.
 *
 *   - 임계치 경고: <0.3GB(🔴 곧 소진) / <0.7GB(🟡 충전 준비)
 *   - 주간 리포트(월요일): 7일 스냅샷 비교로 실사용량 + 월 비용 추정.
 *     "추산" 이 아니라 IPRoyal 실측 잔량 차이 기반이라 정확하다.
 *
 * IPROYAL_API_TOKEN 미설정이면 조용히 스킵 (토큰 = 대시보드 Settings →
 * API 섹션에서 발급, /etc/mavai.env 또는 .env 에 저장).
 *
 * IPRoyal API: GET https://resi-api.iproyal.com/v1/residential/me
 *   → { available_traffic: <GB>, ... }  (Bearer 토큰 인증)
 */
import { notifySlack } from "../src/lib/slack";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const SNAP_FILE = join(process.cwd(), "cache", "proxy-balance.json");
const PRICE_PER_GB = 1.75; // IPRoyal Residential 대략 $/GB (월 비용 추정용)

type Snap = { date: string; gb: number };

export async function checkProxyBalance(): Promise<void> {
  const token = process.env.IPROYAL_API_TOKEN;
  if (!token) {
    console.log("[proxy-balance] IPROYAL_API_TOKEN 미설정 — 스킵");
    return;
  }

  let gb: number;
  try {
    const res = await fetch(
      "https://resi-api.iproyal.com/v1/residential/me",
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!res.ok) {
      console.error(`[proxy-balance] IPRoyal API ${res.status}`);
      return;
    }
    const data = (await res.json()) as { available_traffic?: number };
    gb = data.available_traffic ?? 0;
  } catch (e) {
    console.error(`[proxy-balance] fetch 실패: ${(e as Error).message}`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log(`[proxy-balance] 잔여 ${gb.toFixed(2)}GB`);

  // 스냅샷 누적 (오늘 날짜는 덮어씀, 최근 60일 유지).
  let snaps: Snap[] = [];
  try {
    snaps = JSON.parse(await readFile(SNAP_FILE, "utf-8")) as Snap[];
  } catch {
    // 첫 실행 — 빈 배열
  }
  snaps = snaps.filter((s) => s.date !== today);
  snaps.push({ date: today, gb });
  snaps.sort((a, b) => a.date.localeCompare(b.date));
  snaps = snaps.slice(-60);
  try {
    await mkdir(join(process.cwd(), "cache"), { recursive: true });
    await writeFile(SNAP_FILE, JSON.stringify(snaps));
  } catch {
    // 스냅샷 저장 실패는 비치명적
  }

  // 임계치 경고 (매일).
  if (gb < 0.3) {
    await notifySlack(
      `🔴 *IPRoyal 프록시 잔여 ${gb.toFixed(2)}GB — 곧 소진!*\n` +
        `충전: 대시보드 → Residential → Create order → Pay As You Go.\n` +
        `(소진되면 광고 수집 cron 이 전부 실패합니다.)`
    );
  } else if (gb < 0.7) {
    await notifySlack(
      `🟡 IPRoyal 프록시 잔여 ${gb.toFixed(2)}GB — 며칠 내 소진 예상. 충전 준비하세요.`
    );
  }

  // 주간 리포트 (월요일) — 7일 전 스냅샷 대비 실사용량 + 월 비용 추정.
  if (new Date().getDay() === 1) {
    const d7 = new Date(Date.now() - 7 * 86400000)
      .toISOString()
      .slice(0, 10);
    const past = snaps.find((s) => s.date <= d7) ?? snaps[0];
    if (past && past.date !== today && past.gb >= gb) {
      const usedGb = past.gb - gb;
      const days = Math.max(
        1,
        (Date.parse(today) - Date.parse(past.date)) / 86400000
      );
      const dailyGb = usedGb / days;
      const monthGb = dailyGb * 30;
      const monthCost = monthGb * PRICE_PER_GB;
      await notifySlack(
        `📊 *주간 IPRoyal 리포트*\n` +
          `• 최근 ${Math.round(days)}일 사용: ${usedGb.toFixed(2)}GB ` +
          `(일 평균 ${dailyGb.toFixed(3)}GB)\n` +
          `• 이 페이스 → 월 ~${monthGb.toFixed(1)}GB ≈ ` +
          `*$${monthCost.toFixed(1)}/월* (프록시) + $6 (VM) = ` +
          `*$${(monthCost + 6).toFixed(0)}/월*\n` +
          `• 현재 잔여: ${gb.toFixed(2)}GB`
      );
    } else {
      await notifySlack(
        `📊 IPRoyal 주간 리포트 — 현재 잔여 ${gb.toFixed(2)}GB ` +
          `(스냅샷 누적 중, 다음 주부터 실사용 페이스·월 비용 표시)`
      );
    }
  }
}

// 직접 실행 지원 (테스트용): tsx scripts/proxy-balance.ts
const entry = process.argv[1] ?? "";
if (entry.endsWith("proxy-balance.ts") || entry.endsWith("proxy-balance.js")) {
  checkProxyBalance()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
