# launchd 지침

## 범위

로컬 자동 실행 설정과 `scripts/run-tracked.ts` cron 로그가 있는 영역이다.

## 작업 기준

- plist 변경 전후로 실행 주기, working directory, 로그 경로를 확인한다.
- watch 실행 로직 자체는 `scripts/run-tracked.ts` 에 둔다. launchd 문서는 스케줄과 실행 환경만 관리한다.
- 로그 파일이 커지면 원인 스크립트를 먼저 확인하고, 단순 삭제/비우기는 사용자 확인 후 진행한다.

## 검증

- `launchd/INSTALL.md` 절차를 기준으로 load/unload 상태를 확인한다.
- cron 결과는 `launchd/run-tracked.out.log` 와 DB의 watch/job 상태를 함께 본다.
