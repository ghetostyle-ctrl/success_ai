# 마브AI — 셋업 가이드

공개 광고 데이터 레퍼런스 아카이브. **구글 광고 투명성 센터(ATC)** + **메타
광고 라이브러리** + **YouTube** 공개 통계를 모아 트렌드를 추적합니다.

> 이 배포본에는 실제 운영 데이터·API 키·서버 접속 정보가 들어 있지
> 않습니다. 아래 절차로 본인 환경에서 처음부터 세팅하세요.

---

## 1. 요구 사항

- Node.js 20+ (`npx tsx` 사용)
- (선택) 주거용 프록시 계정 — 구글 ATC 안정 수집에 강력 권장
- (선택) yt-dlp + ffmpeg — 소재 mp4 **다운로드(⬇ 버튼)** 와 해부 기능용
  - Windows: `winget install yt-dlp.yt-dlp`
  - macOS: `brew install yt-dlp ffmpeg`
  - 설치 후 앱을 **재시작**해야 PATH 가 반영됩니다.

## 2. 설치

```bash
npm install
cp .env.example .env.local     # 앱용 — 값 채우기 (아래 3번)
cp .env.example .env           # Prisma CLI 용 (주의 참고)
npx prisma generate            # Prisma 클라이언트 생성
npx prisma db push             # 빈 SQLite DB(dev.db) 스키마 생성
npm run dev -- --port 3001      # http://localhost:3001
```

> ⚠️ **`.env` 와 `.env.local` 둘 다 필요합니다.**
>
> `prisma.config.ts` 는 `dotenv` 로 **`.env` 만** 읽습니다. `.env.local` 에만
> `DATABASE_URL` 을 넣으면 `prisma db push` 가
> `datasource.url property is required` 로 실패합니다.
>
> 내용은 같아도 됩니다 — 둘 다 `DATABASE_URL="file:./dev.db"` 면 앱과
> Prisma CLI 가 프로젝트 루트의 같은 `dev.db` 를 봅니다.

## 3. 환경변수 (`.env.local`)

`.env.example` 의 주석 참고. 최소 동작엔 아무것도 없어도 되지만:

| 변수 | 필수도 | 용도 |
|---|---|---|
| `DATABASE_URL` | 기본값 OK | SQLite 경로 |
| `YOUTUBE_API_KEY` | 권장 | 영상 조회수/통계. Google Cloud Console 에서 발급 |
| `PROXY_URL` | 강력 권장 | 구글 ATC 봇 차단 우회 (주거용 프록시) |
| `SLACK_WEBHOOK_URL` | 선택 | 수집 성공/실패 알림 |
| `IPROYAL_API_TOKEN` | 선택 | IPRoyal 잔량 경고 (다른 프록시면 무시) |

### ⚠️ 프록시가 핵심
구글 ATC 는 데이터센터 IP(AWS/GCP/클라우드 서버)를 **즉시 봇 차단**합니다.
로컬 개발(집/사무실 IP)에선 프록시 없이도 소량 되지만, 서버 배포 시엔
**주거용(residential) 프록시 필수**. IPRoyal·Bright Data 등 아무거나 가능.
형식만 `http://USER:PASS@HOST:PORT` 맞추면 됩니다.

## 4. 사용

- **상단 검색창**: 도메인(`example.co.kr`) 또는 브랜드명을 넣으면 구글 투명성
  센터의 해당 광고를 전부 훑습니다. 📸 를 켜면 1회만 조사하고 자동 갱신
  대상에서 빠집니다.
- **🗂 브랜드 아카이브**: 첫 화면. 브랜드 카드 + 최근 소재 썸네일.
- **📋 광고 목록**: 표 뷰. 정렬·필터·CSV/JSON·소재 mp4 다운로드(⬇).
- **🎬 소재 비교**: 브랜드를 가로질러 영상 광고만 비교. 조회수 대역·소재
  나이(3주+ / 2개월+)·캠페인 재사용 수로 거릅니다.
- **사이드바**: 추적 중인 브랜드 목록. A1/A2/A3 중요도 그룹(색 dot) +
  자유 태그로 분류.
- **📘 메타 광고**: 메타 광고 라이브러리 브랜드별 수집 (트래픽 큼, confirm 후).

## 5. 자동 갱신 (선택)

매일 새벽 추적 중인 브랜드를 자동으로 다시 불러오려면 `launchd/` 참고 (macOS).
Linux 는 cron 으로 `npx tsx scripts/run-tracked.ts` 를 스케줄하면 됩니다.
plist 안의 `/PATH/TO/mav-ai`, `/Users/YOUR_USERNAME` 을 본인 경로로
교체하세요.

## 6. 배포

정적 호스팅이 아니라 **Node 서버**가 필요합니다 (Next.js + Prisma + 프록시
호출). VM(Vultr/AWS/NCP 등)에 올리고 PM2 등으로 상주시키는 구조를 권장.
서버 IP 는 데이터센터라 ATC 가 차단하므로 **반드시 프록시 경유**.

## 7. 구조

- `src/app/` — Next.js 앱 (UI + API 라우트)
- `src/lib/atc-scraper.ts` — 구글 투명성 센터 수집 핵심 로직 (페이지네이션)
- `src/lib/meta-scraper*.ts` — 메타 광고 라이브러리 수집
- `scripts/run-tracked.ts` — 자동 갱신 배치 (cron/launchd 용)
- `prisma/schema.prisma` — DB 스키마 (Watch/Ad/Job/AdStat 등)

각 폴더의 `AGENTS.md` 에 세부 설명이 있습니다.
