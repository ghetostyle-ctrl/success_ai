/**
 * Claude Vision pass over a dissection's scene thumbnails. For each
 * scene we ask the model to:
 *   1) Pull any text overlaid on the frame ("화면 자막") — Korean OCR.
 *   2) Tag the scene with one of the standard ad-creative categories
 *      (AI영상 / 연예인 / 파트너쉽 / 샤오홍슈 / 셀프캠 / 기타).
 *
 * The reference tool ("똑같이만들기") batches both signals into a single
 * Claude Vision call per frame to keep latency and cost in check; we
 * mirror that. Approx cost is 30~70원/frame on Sonnet 4.6.
 *
 * Designed to be safely re-runnable: only fills empty fields by default
 * so manual edits in the UI are preserved.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.VISION_MODEL || "claude-sonnet-4-6";

export const SCENE_CATEGORIES = [
  "AI영상",
  "연예인",
  "파트너쉽",
  "샤오홍슈",
  "셀프캠",
  "기타",
] as const;
export type SceneCategory = (typeof SCENE_CATEGORIES)[number];

export type EnrichedScene = {
  visibleText: string;
  category: SceneCategory | "";
};

const SYSTEM_PROMPT = `당신은 한국 디지털 광고 소재를 한 컷 단위로 분석하는 어시스턴트입니다.
입력으로 광고 영상의 한 장면 썸네일(JPEG)이 주어집니다.

다음 두 가지를 정확하게 추출해 JSON으로만 응답하세요:

1) "visibleText": 프레임 위에 그래픽으로 박힌 한국어 텍스트(자막/캡션/메인 카피).
   - 인물의 얼굴이나 배경에 자연스럽게 있는 글자(상품 라벨, 간판 등)는 제외.
   - 화면 가운데 큰 글씨, 상하단 자막 띠, 화살표 옆 강조 카피 등이 대상.
   - 줄바꿈은 한 줄로 합쳐 공백으로 정리.
   - 발견된 텍스트가 없으면 빈 문자열.

2) "category": 다음 중 하나만 골라 표기.
   - "AI영상": AI 생성 인물/배경, 부자연스러운 모션·얼굴, 합성 음성 인서트.
   - "연예인": 실존 연예인이 클로즈업으로 등장 (셀럽 광고).
   - "파트너쉽": 인플루언서/일반인이 제품을 들고 리뷰하는 협찬 콘텐츠 형식.
   - "샤오홍슈": 중국 샤오홍슈/소셜 콜라주 스타일 (그리드 컷, 손글씨 캡션, 화려한 스티커).
   - "셀프캠": 셀카 정면 앵글, 카메라 직접 응시, 일상 브이로그 톤.
   - "기타": 위 어디에도 명확히 들어가지 않을 때.

응답은 반드시 다음 JSON 한 줄만:
{"visibleText": "...", "category": "..."}
다른 설명, 마크다운, 코드 블록을 포함하지 마세요.`;

async function classifyOne(
  imageBytes: Buffer,
  apiKey: string
): Promise<EnrichedScene> {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: imageBytes.toString("base64"),
              },
            },
            {
              type: "text",
              text: "이 한 컷에서 visibleText와 category를 추출하세요.",
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Vision ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const raw = data.content?.find((c) => c.type === "text")?.text ?? "";
  // Strip code fences if the model slipped any in.
  const json = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  let parsed: { visibleText?: unknown; category?: unknown } = {};
  try {
    parsed = JSON.parse(json);
  } catch {
    // Last-ditch: pull out the first {...} block if there's preamble.
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        // give up — return empty
      }
    }
  }
  const visibleText =
    typeof parsed.visibleText === "string" ? parsed.visibleText.trim() : "";
  const cat =
    typeof parsed.category === "string" ? (parsed.category as string) : "";
  const category = (SCENE_CATEGORIES as readonly string[]).includes(cat)
    ? (cat as SceneCategory)
    : "";
  return { visibleText, category };
}

export async function enrichScenes(opts: {
  workdir: string;
  scenes: Array<{
    seq: number;
    thumbnailPath: string;
    visibleText: string | null;
    category: string | null;
  }>;
  // When false (default), skip rows that already have manual edits.
  overwrite?: boolean;
  onLog?: (line: string) => void;
}): Promise<{
  enriched: Array<{ seq: number; visibleText: string; category: string }>;
  visibleTextFilled: number;
  categoryFilled: number;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    throw new Error(
      "ANTHROPIC_API_KEY not set — required for Claude Vision enrichment"
    );
  const log = (m: string) =>
    opts.onLog?.(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

  const enriched: Array<{
    seq: number;
    visibleText: string;
    category: string;
  }> = [];
  let visibleTextFilled = 0;
  let categoryFilled = 0;

  for (const scene of opts.scenes) {
    const skip =
      !opts.overwrite &&
      Boolean(scene.visibleText) &&
      Boolean(scene.category);
    if (skip) {
      enriched.push({
        seq: scene.seq,
        visibleText: scene.visibleText ?? "",
        category: scene.category ?? "",
      });
      continue;
    }
    const imgPath = join(opts.workdir, scene.thumbnailPath);
    let bytes: Buffer;
    try {
      bytes = await readFile(imgPath);
    } catch (e) {
      log(`  scene ${scene.seq}: thumbnail missing (${(e as Error).message})`);
      enriched.push({
        seq: scene.seq,
        visibleText: scene.visibleText ?? "",
        category: scene.category ?? "",
      });
      continue;
    }
    log(`  scene ${scene.seq}: vision call (${(bytes.length / 1024).toFixed(0)}KB)`);
    try {
      const out = await classifyOne(bytes, apiKey);
      const visibleText = scene.visibleText && !opts.overwrite
        ? scene.visibleText
        : out.visibleText;
      const category = scene.category && !opts.overwrite
        ? scene.category
        : out.category;
      if (!scene.visibleText && out.visibleText) visibleTextFilled++;
      if (!scene.category && out.category) categoryFilled++;
      enriched.push({ seq: scene.seq, visibleText, category });
    } catch (e) {
      log(`  scene ${scene.seq}: ${(e as Error).message}`);
      enriched.push({
        seq: scene.seq,
        visibleText: scene.visibleText ?? "",
        category: scene.category ?? "",
      });
    }
  }
  return { enriched, visibleTextFilled, categoryFilled };
}
