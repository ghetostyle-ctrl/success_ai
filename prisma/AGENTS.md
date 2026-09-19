# prisma 지침

## 범위

SQLite 스키마와 마이그레이션 영역이다. Prisma client는 `src/generated/prisma` 로 생성된다.

## DB 기준

- 로컬 개발 DB는 `DATABASE_URL` 또는 기본 `file:./dev.db` 흐름을 따른다.
- DB 파일은 프로젝트 루트의 `dev.db` 다 (`.gitignore` 대상).
- `prisma/dev.db` 는 0 bytes일 수 있으므로 운영 조회/판단에 쓰지 않는다.

## 스키마 작업 기준

- `Ad`, `MetaAd`, `Video`, `AdStat`은 수집 결과와 시계열 히스토리의 핵심 자산이다. 덮어쓰기 전에 unique/index/upsert 의도를 확인한다.
- `Watch`, `MetaWatch`, `ShellChannel`은 반복 수집의 입력이다. 한 번 판정한 page/channel/keyword 연결은 DB에 남기는 방향을 우선한다.
- 새 필드는 “다음 실행에서 LLM이 다시 판단하지 않게 하는가”를 기준으로 추가를 검토한다.
- generated client는 직접 수정하지 않는다. schema/migration을 수정하고 재생성한다.

## 검증

- 마이그레이션 전후로 row count와 대표 쿼리를 비교한다.
- 운영 DB에 적용하는 변경은 백업/복구 경로를 먼저 확보한다.
- unique 제약을 추가할 때는 기존 중복 데이터를 먼저 조사한다.
