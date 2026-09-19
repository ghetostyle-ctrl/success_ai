# scripts 지침

## 범위

탐색, 디버깅, 백필, watch 실행, 운영 보조 스크립트가 있는 영역이다. 반복될 작업은 여기 스크립트로 남기고 루트 문서에는 이름/용도만 등록한다.

## 주요 스크립트

- `run-tracked.ts`: 등록된 ATC/Meta/ShellChannel watch를 cron에서 실행한다.
- `discover-shell-channels.ts`: 브랜드와 연결된 YouTube shell channel 후보를 찾는다.
- `import-shell-channel.ts`: 검증된 shell channel을 DB에 등록한다.
- `run-shells-only.ts`: ShellChannel refresh만 별도로 실행한다.
- `backfill-stats.ts`: 저장된 광고의 YouTube stats를 보강한다.
- `probe-*`, `dump-*`, `debug-*`, `capture-*`: Discovery/디버깅용. 성공 패턴은 운영 코드나 재사용 스크립트로 승격한다.

## 작업 기준

- 스크립트는 `.env.local` 다음 `.env` 순서로 로드하는 기존 패턴을 따른다.
- 운영 DB 작업 전에는 대상 DB 경로를 명시적으로 확인한다. 기본값은 프로젝트 루트의 `dev.db` 다.
- API 키, 프록시 URL, 토큰은 인자로 출력하거나 로그에 남기지 않는다.
- 대량 큐잉/백필은 rate limit과 프록시 트래픽을 고려해 sleep, batch size, resume 기준을 둔다.
- 한 번 검증된 discovery 로직이 재사용될 것 같으면 `probe-*`에 방치하지 말고 이름 있는 스크립트로 정리한다.

## 검증

- dry-run이 가능하면 먼저 dry-run을 둔다.
- 운영 반영 스크립트는 처리 수, skip 수, 실패 수를 마지막에 요약한다.
- 실패 재시도는 무한 루프 대신 bounded retry와 실패 로그를 남긴다.
