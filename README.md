# Success AI — 경쟁 브랜드 광고 레퍼런스 수집기

경쟁 브랜드가 **지금 어떤 광고를 돌리고 있는지** 한 화면에서 보는 도구입니다.
브랜드명이나 도메인을 넣으면 **구글 광고 투명성 센터**와 **메타 광고 라이브러리**에
공개된 광고를 모아서, 어떤 소재가 오래 살아남았고 어떤 게 치고 올라오는지 보여줍니다.

- 무료. 각 플랫폼이 **투명성 의무로 공개한 데이터**만 읽습니다.
- 로그인·계정 연동 없음. 수집 결과는 내 PC 의 SQLite 파일(`dev.db`) 하나에만 저장됩니다.
- 광고에 붙은 YouTube 영상을 찾아 **조회수·좋아요·게시일**을 붙이고, 며칠 쌓이면
  ⭐주력 / 📈상승세 / ⚡급등 / 📉둔화 / 🌱새 캠페인 배지가 자동으로 붙습니다.

> 이 저장소는 [mabsaki 님의 마브AI(mav-ai)](https://github.com/chonamgyu/mav-ai) 를
> MIT 라이선스에 따라 포크한 것입니다. 원본 대비 바뀐 점: Windows 원클릭 설치
> 스크립트, 작업 스케줄러 등록 스크립트, 누락돼 있던 `.env.example`, 한국어 README.

---

## 1. 설치 (Windows, 5분)

**필요한 것**: [Node.js 20 이상](https://nodejs.org) (LTS), [git](https://git-scm.com)

PowerShell 을 열고 한 줄:

```powershell
irm https://raw.githubusercontent.com/ghetostyle-ctrl/success_ai/main/install.ps1 | iex
```

또는 직접 클론한 뒤:

```powershell
git clone https://github.com/ghetostyle-ctrl/success_ai.git C:\success_ai
cd C:\success_ai
.\install.ps1
```

스크립트가 하는 일: `npm install` → Playwright Chromium 설치 → `.env`/`.env.local` 생성 →
Prisma 클라이언트 생성 → SQLite DB 초기화. 이미 설치된 항목은 건너뜁니다.

> **실행 정책 오류**가 나면 (`이 시스템에서 스크립트를 실행할 수 없으므로…`):
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 를 한 번 실행하세요.

<details>
<summary>macOS / Linux</summary>

```bash
git clone https://github.com/ghetostyle-ctrl/success_ai.git && cd success_ai
npm install && npx playwright install chromium
cp .env.example .env && cp .env.example .env.local
npx prisma generate && npx prisma db push
npm run dev
```
자동 수집은 `launchd/INSTALL.md`(macOS) 또는 cron 으로 `npx tsx scripts/run-tracked.ts`.
</details>

## 2. YouTube API 키 (꼭 하세요, 무료)

키가 없어도 광고 수집은 되지만 **조회수와 모든 배지가 비어 있습니다.**

1. [Google Cloud Console](https://console.cloud.google.com) 로그인 → 프로젝트 선택(또는 새로 만들기)
2. **API 및 서비스 → 라이브러리** → `YouTube Data API v3` 검색 → **사용**
3. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키**
4. 만들면서(또는 만든 뒤 편집) **API 제한사항 → 키 제한 → YouTube Data API v3 만 체크** → 저장
5. 키를 `.env` 와 `.env.local` **둘 다**의 `YOUTUBE_API_KEY=` 뒤에 붙여넣기

설치 스크립트에 키를 바로 넘겨도 됩니다:

```powershell
.\install.ps1 -YouTubeApiKey "여기에_키"
```

무료 할당량은 하루 10,000 유닛(영상 1개 조회 = 1 유닛), 태평양 시간 자정 초기화.

## 3. 실행

```powershell
cd C:\success_ai
.\start.ps1          # 서버 실행 + 브라우저 자동 열기 (http://localhost:3000)
```

## 4. 사용법

1. 상단 검색창에 **브랜드명**(`올리브영`) 또는 **도메인**(`oliveyoung.co.kr`)을 넣고 **불러오기**. 30~90초.
   - 쉼표로 여러 개 가능. **1회만**을 켜면 이번만 조사하고 자동 갱신에서 빠집니다.
   - 도메인 = 그 도메인이 직접 띄운 광고, 브랜드명 = 광고주(법인) 단위.
2. 탭
   | 탭 | 용도 |
   |---|---|
   | 브랜드 아카이브 | 브랜드 카드 + 최근 소재 썸네일 |
   | 구글 광고 | 투명성 센터 표. 정렬·필터·CSV·mp4 다운로드 |
   | 메타 광고 | 페이스북·인스타 광고. 카피 전문 + 변형 개수 |
   | 소재 비교 | 브랜드 가로질러 영상 광고만 비교 |
   | 대시보드 | 추적 중인 브랜드 전체 현황 |
3. **메타는 따로 불러야 합니다.** 브랜드 하나에 약 200MB 트래픽이 들어서 메타 탭에서 직접 누를 때만 수집합니다.
4. **하루 한 번, 같은 시간에 돌리세요.** 배지는 일별 스냅샷이 2~3개 쌓여야 계산됩니다. 첫날엔 안 보이는 게 정상.

### 매일 자동 수집 (Windows 작업 스케줄러)

```powershell
.\schedule-daily.ps1              # 매일 03:00 등록
.\schedule-daily.ps1 -At 04:30    # 시각 변경
.\schedule-daily.ps1 -RunNow      # 지금 한 번 실행
.\schedule-daily.ps1 -Unregister  # 해제
```

로그는 `logs\run-tracked.log`. PC 가 꺼져 있으면 다음 부팅 후 실행됩니다.

## 5. 조회수는 "광고 노출수"가 아닙니다

구글은 광고 노출수·비용을 공개하지 않습니다. 이 도구는 광고에 붙은 **YouTube 영상의 공개 조회수**를
가져와 붙입니다. 유기적 조회와 광고 노출이 합쳐진 숫자이니 **절대값보다 브랜드 안 상대 순위**로 보세요.
이미지 광고나 YouTube 에 없는 소재는 숫자가 비어 있는 게 정상입니다.

## 6. 배지

| 배지 | 기준 |
|---|---|
| ⭐ 주력 | 누적 50만+ 이면서 하루 평균 5천+ |
| 📈 상승세 | 최근 3일 평균 증가량이 전체 평균의 1.25배 이상 |
| ⚡ 급등 | 직전 대비 180% 이상 |
| 📉 둔화 | 최근 3일 연속 증가량 하락 |
| 🌱 새 캠페인 | 투명성 센터에 처음 잡힌 지 10일 이내 |
| 🆕 새 소재 | YouTube 게시 21일 이내 |

레퍼런스로 쓸 땐 **소재 나이 필터 3주+ / 2개월+** 로 "오래 살아남은 = 검증된" 소재만 추리세요.

## 7. 자주 묻는 질문

**수집이 실패하고 `/sorry/` 또는 봇 차단이 떠요**
구글이 이 IP 를 봇으로 본 겁니다. 1~3시간 뒤 다시 하세요. 브랜드를 연달아 돌리지 말고 사이에 텀을 두세요.
자주 겪으면 `.env.local` 의 `PROXY_URL` 에 주거용 프록시를 넣으세요. 클라우드 서버에선 사실상 필수입니다.

**조회수가 전부 비고 배지가 없어요** — `YOUTUBE_API_KEY` 가 없거나 할당량 초과입니다.

**브랜드명으로 검색했더니 엉뚱한 회사 광고가 섞여요** — 투명성 센터는 광고주(법인) 단위입니다.
도메인으로 검색한 뒤 표 위의 **이 도메인만**을 켜세요.

**채널명이 `bgch01`, `Video ad upload channel` 같은 것만 나와요** — 실제 채널명입니다.
브랜드를 감추려고 이름 없는 채널에 광고 소재만 올리는 경우가 많습니다.

**mp4 다운로드에서 `yt-dlp 가 설치돼 있지 않습니다`** — `winget install yt-dlp.yt-dlp` 후 앱을 완전히 껐다 켜세요.

**`prisma db push` 가 `datasource.url property is required` 로 실패해요** — `.env` 가 없습니다. `.env.local` 만으론 Prisma 가 못 읽습니다.

**데이터가 외부로 나가나요?** — 아니요. 프로젝트 폴더의 `dev.db` 하나에만 저장됩니다. 지우려면 사이드바 맨 아래 **전체 데이터 삭제** 또는 `dev.db` 삭제.

**법적으로 괜찮나요?** — 구글·메타가 투명성 의무로 공개한 데이터만 읽습니다. 다만 각 플랫폼 이용약관과 robots 정책은 직접 확인하세요.
수집 주기를 과하게 당기면 차단됩니다. 수집한 데이터의 사용은 사용자 책임입니다.

## 8. 폴더 구조

```
src/            Next.js 앱, API, 수집기(atc-scraper / meta-scraper-web / youtube-stats)
prisma/         SQLite 스키마·마이그레이션
scripts/        run-tracked.ts(자동 수집), 탐색·백필 스크립트
launchd/        macOS 자동 실행
install.ps1     Windows 설치      start.ps1  실행      schedule-daily.ps1  작업 스케줄러
```

## 라이선스

MIT © 2026 mabsaki (원저작자) · 포크 및 추가분도 MIT. `LICENSE` 참고.
