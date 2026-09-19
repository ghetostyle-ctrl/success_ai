/**
 * GET /api/download?youtubeId=<id>[&name=<파일명 힌트>]
 *
 * 광고 소재 영상을 mp4 로 받아서 그대로 브라우저에 흘려준다. 목록의 "보기"
 * 옆 ⬇ 버튼이 이걸 부른다.
 *
 * 왜 서버에서 받아 오나: YouTube 는 브라우저에서 직접 mp4 를 긁을 수
 * 없다 (스트림이 분리돼 있고 CORS 도 막힌다). yt-dlp 가 영상/음성 스트림을
 * 골라 합쳐주는 역할을 한다 — 소재 해부(dissect) 기능이 이미 쓰는 것과
 * 같은 경로다.
 *
 * yt-dlp 가 없으면 422 로 설치 안내를 돌려준다. 다운로드는 부가 기능이라
 * 이것 때문에 앱이 죽으면 안 된다.
 */
import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// dissect.ts 와 같은 환경변수를 본다 — 한 번만 잡으면 양쪽 다 동작.
const YT_DLP =
  process.env.YT_DLP_PATH || process.env.YTDLP_PATH || "yt-dlp";

/** 영상 하나치고도 넉넉한 상한. 초과하면 받다 말고 끊는다. */
const MAX_BYTES = 400 * 1024 * 1024;
/** yt-dlp 가 이 시간 안에 못 끝내면 포기 — 요청이 영원히 매달리지 않게. */
const TIMEOUT_MS = 180_000;

class YtDlpMissingError extends Error {}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const cp = spawn(cmd, args, { cwd });
    let stderr = "";
    const timer = setTimeout(() => {
      cp.kill("SIGKILL");
      reject(new Error(`시간 초과 (${TIMEOUT_MS / 1000}초)`));
    }, TIMEOUT_MS);
    cp.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    cp.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      // spawn 자체가 실패 = 실행 파일이 PATH 에 없음.
      if (e.code === "ENOENT") reject(new YtDlpMissingError());
      else reject(e);
    });
    cp.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(stderr.slice(-500) || `yt-dlp exited ${code}`));
    });
  });
}

/**
 * 파일명에 쓸 수 없는 문자를 걷어낸다. 광고 제목을 그대로 쓰면 Windows 에서
 * 저장이 실패하는 경우가 있어서 (`\ / : * ? " < > |`), 제어문자까지 함께 제거.
 */
function safeFileName(raw: string, fallback: string): string {
  const cleaned = raw
    // Windows/macOS 에서 파일명에 못 쓰는 문자
    .replace(/[\\/:*?"<>|]/g, " ")
    // 제어문자 (광고 카피에 개행이 섞여 들어오는 경우가 있다)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const youtubeId = url.searchParams.get("youtubeId")?.trim();
  const nameHint = url.searchParams.get("name")?.trim() ?? "";

  // id 형식 검증 — 여기서 받은 값이 그대로 yt-dlp 인자로 들어가므로,
  // YouTube id 글자셋(영숫자·하이픈·언더스코어)만 통과시킨다.
  if (!youtubeId || !/^[A-Za-z0-9_-]{5,20}$/.test(youtubeId)) {
    return Response.json(
      { error: "youtubeId 가 올바르지 않습니다." },
      { status: 400 }
    );
  }

  let workdir: string | null = null;
  try {
    workdir = await mkdtemp(join(tmpdir(), "mavai-dl-"));
    // dissect 와 같은 포맷 체인. 720p mp4 로 맞춰서 용량과 호환성을 잡는다.
    await run(
      YT_DLP,
      [
        "-f",
        "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/best[height<=720]",
        "--merge-output-format",
        "mp4",
        "-o",
        "video.%(ext)s",
        "--no-playlist",
        "--no-progress",
        "--extractor-args",
        "youtube:player_client=tv_simply,web_safari,android",
        `https://www.youtube.com/watch?v=${youtubeId}`,
      ],
      workdir
    );

    // 합쳐진 산출물 찾기 — 포맷 체인에 따라 확장자가 갈릴 수 있다.
    const files = await readdir(workdir);
    const target =
      files.find((f) => f.endsWith(".mp4")) ??
      files.find((f) => f.startsWith("video."));
    if (!target) throw new Error("받은 파일을 찾지 못했습니다.");

    const buf = await readFile(join(workdir, target));
    if (buf.byteLength > MAX_BYTES) {
      return Response.json(
        { error: "파일이 너무 큽니다 (400MB 초과)." },
        { status: 413 }
      );
    }

    const base = safeFileName(nameHint, youtubeId);
    const filename = `${base}.mp4`;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(buf.byteLength),
        // filename* (RFC 5987) 로 한글 제목을 그대로 살린다. filename= 은
        // 구형 브라우저용 ASCII 대체값.
        "Content-Disposition": `attachment; filename="${youtubeId}.mp4"; filename*=UTF-8''${encodeURIComponent(
          filename
        )}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof YtDlpMissingError) {
      return Response.json(
        {
          error:
            "yt-dlp 가 설치돼 있지 않습니다. 설치 후 다시 시도하세요 " +
            "(winget install yt-dlp / brew install yt-dlp / pip install yt-dlp). " +
            "PATH 에 없으면 .env.local 의 YTDLP_PATH 로 경로를 지정하세요.",
        },
        { status: 422 }
      );
    }
    return Response.json(
      { error: `다운로드 실패: ${(e as Error).message}` },
      { status: 500 }
    );
  } finally {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}
