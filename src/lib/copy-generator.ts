/**
 * "비슷하게만들기" — given a brand's mined copy patterns and a few
 * sample ads, ask Claude Sonnet to write N new ad creative drafts in
 * the same tone. The result is meant as a starting deck the user can
 * tune in the UI before handing off to design / media buying.
 *
 * Inputs are intentionally small (the patterns JSON, 3–5 sample
 * bodies) so the prompt is cheap and the output is grounded in
 * concrete brand language rather than generic Claude-isms.
 */
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.PATTERN_MINER_MODEL || "claude-sonnet-4-6";

export type CopyGeneratorInput = {
  brand: string;
  /** Copy patterns from the brand (output of minePatterns / minePatternsForMeta). */
  patterns: {
    hooks?: { pattern: string; example: string }[];
    benefits?: { pattern: string; example: string }[];
    proofs?: { pattern: string; example: string }[];
    ctas?: { pattern: string; example: string }[];
    sceneFlow?: string[];
    notes?: string;
  };
  /** A handful of real bodies for tone calibration. */
  sampleBodies: string[];
  /**
   * Optional steering prompt — e.g. "신제품 출시 hook으로",
   * "남성 타겟", "단일 컷 정사각 이미지". Free-form Korean.
   */
  brief?: string;
  /** How many drafts to produce. Default 5. */
  count?: number;
  /** Target platform: "meta" (short, CTA-strong) | "youtube" (longer hook). */
  platform?: "meta" | "youtube";
};

export type CopyDraft = {
  /** Headline / first hook line. */
  headline: string;
  /** Main body text. */
  body: string;
  /** CTA / closing call. */
  cta: string;
  /** Why this draft works for the brand — 1-line LLM rationale. */
  rationale: string;
  /** Which input patterns were riffed on. */
  patternsUsed: string[];
};

const SYSTEM_PROMPT = `당신은 한국 디지털 광고 카피라이터입니다.
같은 브랜드의 기존 광고 카피 패턴(hooks/benefits/proofs/ctas/sceneFlow)과 실제 본문 샘플이 입력으로 들어옵니다.
이 패턴을 변주해 그 브랜드 톤으로 새로운 카피 N개를 만들어주세요.

규칙:
- 모든 결과는 한국어. 어색한 번역체 금지. 입력 샘플의 어휘·이모지·구두점을 자연스럽게 차용.
- hook은 첫 1~2 문장, body는 3~6 문장, CTA는 짧고 행동 유도형.
- 입력 patterns의 hook/benefit/proof/CTA 중 최소 2개를 활용해 합성 (단, 그대로 베끼지 말고 변주).
- platform=meta 면: 짧고 명확. 가격훅/할인훅/환불 보장/즉시 클릭 톤.
- platform=youtube 면: 더 긴 도입+스토리텔링. 셀럽/UGC 인용.
- 동일 톤 다른 각도 (지속력 / 셀럽 PICK / 가격 / 신뢰 등) 으로 N개 다양하게.

응답은 반드시 JSON 한 개:
{
  "drafts": [
    {
      "headline": "...",
      "body": "...",
      "cta": "...",
      "rationale": "<왜 이 카피가 brand에 맞는지 1줄>",
      "patternsUsed": ["hook:{셀럽}이 N통 산", "cta:불만족시 100% 환불"]
    },
    ...
  ]
}
JSON 외 텍스트 / 코드 펜스 금지.`;

export async function generateCopy(
  input: CopyGeneratorInput
): Promise<{ drafts: CopyDraft[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const count = input.count ?? 5;
  const platform = input.platform ?? "meta";
  const userText =
    `브랜드: ${input.brand}\n` +
    `타겟 플랫폼: ${platform}\n` +
    `요청: ${count}개 변주 카피 생성\n` +
    (input.brief ? `사용자 브리프: ${input.brief}\n\n` : "\n") +
    `--- 분석된 패턴 ---\n${JSON.stringify(input.patterns, null, 2)}\n\n` +
    `--- 실 카피 샘플 (톤 칼리브레이션) ---\n${input.sampleBodies
      .slice(0, 6)
      .map((b, i) => `${i + 1}. ${b.slice(0, 220)}`)
      .join("\n")}`;

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`
    );
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const raw =
    data.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
      .trim() || "";
  const json = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(json) as { drafts?: CopyDraft[] };
    return { drafts: parsed.drafts ?? [] };
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]) as { drafts?: CopyDraft[] };
      return { drafts: parsed.drafts ?? [] };
    }
    throw new Error(`Generator returned non-JSON: ${raw.slice(0, 200)}`);
  }
}
