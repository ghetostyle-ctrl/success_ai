# src 지침

## 범위

Next.js App Router 앱, API routes, React UI, 수집/분석 라이브러리가 있는 영역이다. Next.js 16.2.4라서 API/파일 구조를 가정하지 말고 필요하면 `node_modules/next/dist/docs/` 를 먼저 확인한다.

## 구조

- `src/app/page.tsx`: 메인 대시보드. 크고 복잡하므로 UI 변경 전 관련 상태/props 흐름을 먼저 찾는다.
- `src/app/api/**/route.ts`: 수집 트리거, watch 관리, dashboard/list/detail API.
- `src/components/**`: 대시보드 패널과 기능별 뷰.
- `src/lib/**`: ATC, Meta, YouTube, dissection, pattern mining, DB 접근.
- `src/generated/prisma/**`: Prisma 생성물. 직접 수정하지 않는다.

## 작업 기준

- 수집 로직은 `Discovery`와 `Execution`을 분리한다. 반복 실행 경로에는 LLM 판단을 넣지 않는다.
- API route는 얇게 유지하고, 재사용 로직은 `src/lib` 로 올린다.
- Google ATC, Meta, YouTube, stats sync, dissection은 성격이 다르므로 한 파이프라인으로 합치지 않는다.
- 운영 DB에 이미 저장된 판정/수집 결과를 재판정하지 말고 upsert/skip 기준을 먼저 확인한다.
- 외부 호출에는 env 기반 키/프록시를 사용한다. 키를 코드, 로그, 문서에 쓰지 않는다.

## 도메인 주의점

- `PROXY_URL` 의 `_country-kr` 유지가 Meta/ATC 결과 정확도에 중요하다.
- Meta 웹 스크래퍼는 Graph API 대체가 아니라 현재 운영 경로다. `META_MODE` 기본값은 web이다.
- Meta 카드 root 탐지는 `라이브러리 ID:` 기반 ancestor climb 패턴을 보존한다.
- Meta brand guard는 `MetaWatch`의 `page:<id>` trust set과 카피 매칭을 같이 고려한다.
- YouTube 통계는 일별 `AdStat` 스냅샷으로 축적한다. 최신 값만 덮어써서 히스토리를 잃지 않는다.

## 검증

- 기본 빌드/정적 검증: `npm run build`, `npm run lint`
- 수집 변경 검증은 대표 1건이 아니라 날짜 필터, pagination/scroll, 중복, 누락, advertiser/page 단위 전체성까지 본다.
- UI 변경 후에는 로컬 dev 서버에서 실제 화면을 확인한다.
