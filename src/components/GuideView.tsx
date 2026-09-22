"use client";

/**
 * 사용법 / FAQ 탭.
 *
 * 처음 쓰는 사람이 막히는 지점은 대체로 정해져 있다 — 키를 안 받아서
 * 숫자가 비거나, 봇 차단에 걸리거나, 배지가 첫날 안 보여서 고장난 줄
 * 안다. 그걸 순서대로 답해 둔 페이지다. README 와 내용이 겹치지만,
 * 앱 안에서 바로 볼 수 있어야 실제로 읽힌다.
 */

import { useState } from "react";

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mv-card p-5">
      <h2 className="mb-3 text-sm font-bold text-[var(--text-primary)]">
        {title}
      </h2>
      <div className="space-y-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">
        {children}
      </div>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent)]">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[var(--text-primary)]">
          {title}
        </div>
        <div className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {children}
        </div>
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-[var(--bg-elev)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--text-primary)]">
      {children}
    </code>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 py-3 text-left"
      >
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">
          {q}
        </span>
        <span className="shrink-0 text-[var(--text-muted)]">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div className="pb-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {children}
        </div>
      )}
    </div>
  );
}

export default function GuideView({
  onGoTo,
}: {
  onGoTo?: (tab: "archive" | "ads" | "meta") => void;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* .mv-card 가 background 를 흰색으로 지정해서 Tailwind 그라디언트
          유틸이 묻힌다 (흰 배경 + 흰 글씨 = 안 보임). 여기서는 카드 모양만
          빌리고 배경은 인라인으로 직접 칠한다. */}
      <div
        className="rounded-[var(--radius-card)] p-6 text-white shadow-[var(--shadow-card)]"
        style={{
          background:
            "linear-gradient(135deg, var(--accent), var(--accent-strong))",
        }}
      >
        <h1 className="text-lg font-black">Success AI 사용법</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/85">
          경쟁 브랜드가 지금 어떤 광고를 돌리고 있는지 한 화면에서 봅니다.
          구글과 메타가 <b>법적으로 공개하게 돼 있는</b> 광고 데이터만
          읽습니다. 수집한 내용은 내 PC 파일에 저장되고 어디로도 보내지
          않습니다.
        </p>
      </div>

      <Section id="quickstart" title="⚡ 3분 만에 시작하기">
        <div className="space-y-4">
          <Step n={1} title="브랜드 불러오기">
            맨 위 검색창에 <b>브랜드명</b>(<Code>올리브영</Code>) 또는{" "}
            <b>도메인</b>(<Code>oliveyoung.co.kr</Code>)을 넣고{" "}
            <b>불러오기</b>를 누릅니다. 30~90초 걸립니다.
            <div className="mt-1.5 text-[12px] text-[var(--text-muted)]">
              쉼표로 여러 개를 한 번에 넣을 수 있습니다. 도메인으로 넣으면
              그 도메인이 직접 띄운 광고를, 브랜드명으로 넣으면 광고주
              단위로 찾습니다.
            </div>
          </Step>
          <Step n={2} title="아카이브에서 훑기">
            <button
              onClick={() => onGoTo?.("archive")}
              className="font-semibold text-[var(--accent)] hover:underline"
            >
              🗂 브랜드 아카이브
            </button>
            에 브랜드 카드가 생깁니다. 카드 안 썸네일이 그 브랜드가 지금
            돌리는 소재이고, 조회수 높은 순입니다. 썸네일을 누르면 원본
            광고로 갑니다.
          </Step>
          <Step n={3} title="메타도 따로 불러오기">
            <button
              onClick={() => onGoTo?.("meta")}
              className="font-semibold text-[var(--accent)] hover:underline"
            >
              📘 메타 광고
            </button>{" "}
            탭에서 같은 브랜드를 한 번 더 불러옵니다. 메타는 한 번 훑는 데
            트래픽이 200MB쯤 들어서, 검색할 때 자동으로 같이 돌리지
            않습니다.
          </Step>
          <Step n={4} title="며칠 두고 다시 불러오기">
            같은 브랜드를 <b>날짜를 바꿔가며</b> 다시 불러오면 일별 조회수가
            쌓이고, 그때부터 ⭐주력 · 📈상승세 · ⚡급등 배지가 붙습니다.
            <b> 첫날에는 안 보이는 게 정상입니다.</b>
          </Step>
        </div>
      </Section>

      <Section id="tabs" title="🧭 탭별로 뭘 보나">
        <table className="w-full text-[13px]">
          <tbody className="divide-y divide-[var(--border)]">
            {[
              [
                "🗂 브랜드 아카이브",
                "첫 화면. 브랜드당 카드 하나 + 최근 소재 썸네일. 훑어볼 때.",
              ],
              [
                "🟦 구글 광고",
                "구글 투명성 센터에서 가져온 광고 표. 영상 광고는 YouTube에 올라간 소재라 조회수·채널·게시일이 같이 붙습니다. 정렬·필터·CSV·mp4 다운로드.",
              ],
              [
                "📘 메타 광고",
                "메타 광고 라이브러리(페이스북·인스타그램). 카피 전문과 변형(소재 A/B) 개수를 봅니다.",
              ],
              [
                "🎬 소재 비교",
                "브랜드를 가로질러 영상 광고만 모아서 비교. 어떤 소재가 오래 살아남았는지.",
              ],
              ["📊 대시보드", "추적 중인 브랜드 전체 현황과 추이."],
            ].map(([t, d]) => (
              <tr key={t}>
                <td className="w-40 py-2.5 pr-3 align-top font-semibold text-[var(--text-primary)]">
                  {t}
                </td>
                <td className="py-2.5 align-top">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="youtube" title="🟦 구글 광고 표가 YouTube 숫자를 보여주는 이유">
        <p>
          구글 투명성 센터는 <b>어떤 광고를 집행했는지</b>는 공개하지만{" "}
          <b>그 광고가 몇 번 노출됐고 얼마를 썼는지는 공개하지 않습니다.</b>{" "}
          성과를 알 길이 없습니다.
        </p>
        <p>
          다만 구글의 영상 광고는 대부분 <b>YouTube에 올라간 영상</b>을
          소재로 씁니다. 그래서 이 도구는 광고에 붙은 YouTube 영상 ID를
          찾아내, YouTube가 공개하는 <b>조회수·좋아요·댓글·게시일</b>을
          가져와 붙입니다. 표의 조회수와 <Code>회/일</Code>, ⭐📈⚡📉 배지는
          전부 여기서 나옵니다.
        </p>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] leading-relaxed">
          <b className="text-amber-700">그래서 주의할 점</b>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>
              조회수는 <b>광고 노출수가 아닙니다.</b> 유기적 조회와 광고 노출이
              합쳐진 숫자입니다. 절대값보다 <b>브랜드 안에서의 상대 순위</b>로
              보세요.
            </li>
            <li>
              이미지 광고나 YouTube에 없는 소재는 숫자가 비어 있습니다.
              고장이 아닙니다.
            </li>
            <li>
              <Code>YOUTUBE_API_KEY</Code> 가 없으면 이 숫자가 전부 비고,
              배지도 안 붙습니다.
            </li>
          </ul>
        </div>
      </Section>

      <Section id="badges" title="🏷 배지 읽는 법">
        <table className="w-full text-[13px]">
          <tbody className="divide-y divide-[var(--border)]">
            {[
              ["⭐ 주력", "누적 50만+ 이면서 하루 평균 5천+ — 오래 밀고 있는 간판 소재"],
              ["📈 상승세", "최근 3일 평균 증가량이 전체 평균의 1.25배 이상"],
              ["⚡ 급등", "직전 대비 180% 이상 폭증"],
              ["📉 둔화", "최근 3일 연속 증가량 하락 — 소재가 식고 있음"],
              ["🌱 새 캠페인", "투명성 센터에 처음 잡힌 지 10일 이내"],
              ["🎞 새 소재", "YouTube 게시 21일 이내"],
            ].map(([b, d]) => (
              <tr key={b}>
                <td className="w-28 py-2.5 pr-3 align-top font-semibold text-[var(--text-primary)]">
                  {b}
                </td>
                <td className="py-2.5 align-top">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[12px] text-[var(--text-muted)]">
          ⭐📈⚡📉 는 일별 스냅샷이 2~3개 쌓여야 계산됩니다. 하루 한 번씩
          며칠 돌려야 의미가 생깁니다.
        </p>
      </Section>

      <Section id="faq" title="❓ 자주 묻는 질문">
        <div className="-my-3">
          <Faq q="수집이 실패하고 '봇 차단' 또는 /sorry/ 가 떠요">
            구글이 이 IP를 봇으로 보고 막은 겁니다. 짧은 시간에 많이 긁으면
            걸립니다. <b>1~3시간 기다렸다가</b> 다시 하면 대개 풀립니다.
            브랜드를 연달아 여러 개 돌리지 말고 사이에 텀을 두세요.
            <div className="mt-1.5">
              자주 겪는다면 <Code>.env.local</Code> 의 <Code>PROXY_URL</Code> 에
              주거용 프록시를 넣으면 거의 사라집니다. 서버(클라우드 VM)에
              올려 쓰는 경우에는 데이터센터 IP라 <b>프록시가 사실상
              필수</b>입니다.
            </div>
          </Faq>

          <Faq q="조회수가 전부 비어 있고 배지가 하나도 안 붙어요">
            <Code>YOUTUBE_API_KEY</Code> 가 없거나 할당량을 넘겼습니다.
            <div className="mt-1.5">
              키는 Google Cloud Console에서 무료로 5분이면 받습니다. 새
              프로젝트 생성 → <b>YouTube Data API v3</b> 사용 설정 →
              사용자 인증 정보에서 API 키 생성 → <Code>.env.local</Code> 의{" "}
              <Code>YOUTUBE_API_KEY=</Code> 뒤에 붙여넣고 앱 재시작.
            </div>
            <div className="mt-1.5">
              하루 할당량은 10,000 유닛입니다. 대형 광고주를 여러 번 돌리면
              닿을 수 있고, 넘으면 조용히 멈춥니다. 다음 날 자정(태평양 시간)에
              초기화됩니다.
            </div>
          </Faq>

          <Faq q="배지가 첫날엔 안 보여요. 고장인가요?">
            정상입니다. ⭐📈⚡📉 는 <b>조회수가 시간에 따라 어떻게 변했는지</b>로
            판정하기 때문에, 비교할 어제 데이터가 있어야 계산됩니다. 같은
            브랜드를 다음 날 한 번 더 불러오면 그때부터 붙기 시작합니다.
          </Faq>

          <Faq q="브랜드명으로 검색했는데 엉뚱한 회사 광고가 섞여 나와요">
            구글 투명성 센터는 <b>광고주(법인) 단위</b>로 광고를 묶습니다.
            한 회사가 여러 브랜드를 운영하면 전부 딸려옵니다.
            <div className="mt-1.5">
              도메인으로 검색한 뒤 표 위의 <b>🎯 이 도메인만</b> 을 켜면, 그
              도메인이 직접 띄운 광고만 남습니다.
            </div>
          </Faq>

          <Faq q="채널 이름이 bgch01, Video ad upload channel 같은 것만 나와요">
            실제 채널명입니다. 브랜드를 감추려고 이름 없는 채널을 여러 개
            만들어 광고 소재만 올리는 경우가 많습니다.{" "}
            <Code>Video ad upload channel</Code> 은 구글이 채널명을 주지 않을
            때 붙는 기본 라벨입니다. 오류가 아닙니다.
          </Faq>

          <Faq q="메타 광고는 왜 자동으로 안 불러와지나요?">
            메타 광고 라이브러리는 한 브랜드를 훑는 데 트래픽이 약 200MB
            듭니다. 구글 검색할 때마다 같이 돌리면 프록시 요금제가 금방
            소진돼서, <b>메타 탭에서 직접 누를 때만</b> 수집하도록 막아
            뒀습니다.
          </Faq>

          <Faq q="⬇ 를 눌렀더니 'yt-dlp 가 설치돼 있지 않습니다' 가 떠요">
            소재 mp4 다운로드는 <Code>yt-dlp</Code> 라는 외부 프로그램을
            씁니다.
            <div className="mt-1.5">
              Windows: <Code>winget install yt-dlp.yt-dlp</Code>
              <br />
              macOS: <Code>brew install yt-dlp ffmpeg</Code>
            </div>
            <div className="mt-1.5">
              설치한 뒤 <b>앱을 완전히 껐다 다시 켜야</b> 인식됩니다 (새 PATH를
              읽어야 해서).
            </div>
          </Faq>

          <Faq q="'최근 N건만 불러옴' 경고가 떠요">
            표 뷰는 첫 로딩에서 최근 수집순으로 일정 건수까지만 가져옵니다
            (전부 받으면 화면이 느려져서). 사이드바에서 브랜드를 클릭하면 그
            브랜드 광고는 전부 로드됩니다. 브랜드 아카이브 카드의 숫자는 항상
            DB 전체 기준이라 정확합니다.
          </Faq>

          <Faq q="prisma db push 가 datasource.url property is required 로 실패해요">
            <Code>.env</Code> 파일이 없습니다. <Code>.env.local</Code> 만
            만들면 앱은 뜨지만 Prisma 명령은 실패합니다. 둘 다 필요합니다:
            <div className="mt-1.5">
              <Code>cp .env.example .env.local</Code> 그리고{" "}
              <Code>cp .env.example .env</Code>
            </div>
          </Faq>

          <Faq q="수집한 데이터가 외부로 나가나요?">
            나가지 않습니다. 전부 프로젝트 폴더의 <Code>dev.db</Code> 파일
            하나에 저장됩니다. 이 앱은 내 PC에서만 돌고 로그인도 없습니다.
            데이터를 지우려면 사이드바 맨 아래{" "}
            <b>🗑️ 전체 데이터 삭제</b> 를 누르거나 <Code>dev.db</Code> 파일을
            지우면 됩니다.
          </Faq>

          <Faq q="이거 써도 법적으로 괜찮나요?">
            이 도구는 구글과 메타가 <b>투명성 의무에 따라 공개한</b> 광고
            데이터만 읽습니다. 다만 각 플랫폼의 이용약관과 robots 정책은
            직접 확인하고 쓰세요. 수집 주기를 과하게 당기면 차단됩니다.
            수집한 데이터를 어떻게 쓸지는 사용자 책임입니다.
          </Faq>
        </div>
      </Section>

      <Section id="tips" title="💡 잘 쓰는 법">
        <ul className="list-disc space-y-2 pl-4">
          <li>
            <b>하루 한 번, 같은 시간에</b> 돌리세요. 스냅샷 간격이 일정해야
            증가량 비교가 정확합니다.
          </li>
          <li>
            브랜드를 연달아 돌리지 마세요. 사이에 몇 분씩 두면 봇 차단에 덜
            걸립니다.
          </li>
          <li>
            <b>⏳ 나이 필터</b>로 3주+ / 2개월+ 만 보면, 오래 살아남은 =
            성과가 검증된 소재만 추려집니다. 레퍼런스로 쓸 땐 이쪽이
            유용합니다.
          </li>
          <li>
            사이드바 브랜드 이름 왼쪽 점을 누르면 A1/A2/A3 중요도를 매길 수
            있습니다. 추적 대상이 많아지면 필터로 쓰세요.
          </li>
          <li>
            📸 <b>1회만</b> 체크는 “이 브랜드 한 번만 보고 말 것”일 때
            쓰세요. 자동 갱신 대상에서 빠져 트래픽을 아낍니다.
          </li>
        </ul>
      </Section>

      <div className="pb-4 text-center text-[11px] text-[var(--text-muted)]">
        Success AI · MIT License · 공개 광고 데이터 기반
      </div>
    </div>
  );
}
