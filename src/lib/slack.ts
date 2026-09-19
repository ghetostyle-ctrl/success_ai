/**
 * Slack notifications for tracked-job runs.
 *
 * Set SLACK_WEBHOOK_URL in .env / .env.local. Without it, every call
 * is a no-op — useful for development.
 *
 * Webhook URL is created at: https://api.slack.com/messaging/webhooks
 */

export type SlackBlock =
  | { type: "section"; text: { type: "mrkdwn"; text: string } }
  | { type: "context"; elements: Array<{ type: "mrkdwn"; text: string }> }
  | { type: "divider" };

export async function notifySlack(
  text: string,
  blocks?: SlackBlock[]
): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, blocks }),
    });
    if (!res.ok) {
      console.error(
        `[slack] webhook ${res.status}: ${(await res.text()).slice(0, 200)}`
      );
    }
  } catch (e) {
    console.error(`[slack] post failed: ${(e as Error).message}`);
  }
}

export function jobOutcomeMessage(opts: {
  kind: "ad-watch" | "shell-channel";
  target: string; // keyword or channelTitle
  ok: boolean;
  note: string;
  durationSec?: number;
}): string {
  const icon = opts.ok ? "✅" : "❌";
  const tag = opts.kind === "ad-watch" ? "ad" : "🐤";
  const dur = opts.durationSec ? ` · ${opts.durationSec}s` : "";
  return `${icon} *${tag}* ${opts.target} — ${opts.note}${dur}`;
}

// 채널 prefix — webhook 이 다른 채널(#a급경쟁사_알림 등) 공유 중이라
// 메시지 시작에 [광고수집기] 붙여서 출처 명확. SLACK_WEBHOOK_URL 이
// #ai-광고수집기 전용 새 webhook 으로 교체되면 prefix 떼도 됨.
const PREFIX = "[광고수집기]";

// 같은 종류 알림이 짧은 시간 안 반복되지 않도록 in-memory 디바운스. 도구
// 재시작 시 잊혀짐 (의도) — 재시작 직후엔 알림 1번 가는 게 맞음.
const ALERT_COOLDOWN = new Map<string, number>();
function shouldAlert(key: string, cooldownMs: number): boolean {
  const now = Date.now();
  const last = ALERT_COOLDOWN.get(key) ?? 0;
  if (now - last < cooldownMs) return false;
  ALERT_COOLDOWN.set(key, now);
  return true;
}

/**
 * IPRoyal proxy 가 거부 중 → direct fallback 으로 임시 작동.
 * 1시간 1회만 알림 (재시도 폭증 시 슬랙 도배 방지).
 */
export async function notifyProxyDown(detail: string): Promise<void> {
  if (!shouldAlert("proxy-down", 60 * 60 * 1000)) return;
  await notifySlack(`${PREFIX} ⚠️ *proxy 거부* — ${detail}`);
}

/**
 * proxy + direct 둘다 실패 = 수집 완전 정지. 가장 시급.
 * 10분 디바운스 (장애 복구 알림은 따로 안 보냄).
 */
export async function notifyCollectionDown(detail: string): Promise<void> {
  if (!shouldAlert("collection-down", 10 * 60 * 1000)) return;
  await notifySlack(`${PREFIX} 🚨 *수집 정지* — ${detail}`);
}

/**
 * IPRoyal 잔액 임계점 — 0.3GB 미만 = 빨강(시급), 0.7GB 미만 = 노랑.
 * proxy-balance.ts cron 에서 호출. 잔액별 알림 분리 (한 alert key).
 */
export async function notifyLowBalance(gb: number): Promise<void> {
  const tier =
    gb < 0.3 ? "🔴 임박" : gb < 0.7 ? "🟡 주의" : null;
  if (!tier) return;
  if (!shouldAlert(`low-balance-${tier}`, 12 * 60 * 60 * 1000)) return;
  await notifySlack(
    `${PREFIX} ${tier} *IPRoyal 잔액* ${gb.toFixed(2)}GB — 충전 ㄱ ($1.75/GB)`
  );
}
