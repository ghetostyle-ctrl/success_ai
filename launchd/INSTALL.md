# 자동 추적 설치 (macOS launchd)

`scripts/run-tracked.ts` 를 **매일 새벽 03:00**에 1회 실행해 모든 활성
ad-watch + shell-channel을 순차 처리합니다.

분산 cron(10분마다 1건)은 ATC 호출을 하루 종일 흩뿌려서 /sorry/ 봇
챌린지가 만성화되는 부작용이 있어, 1일 1회 batch + 잡 간 10초 쉬기 +
페이지 간 3초 쉬기 + 챌린지 만나면 batch 즉시 abort 패턴으로 회귀.

## 기존 plist에서 업그레이드 (이전 03:00 일괄 → 10분 분산)

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.mavai.daily.plist
cp launchd/com.mavai.daily.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mavai.daily.plist
launchctl list | grep mavai
```

## 처음 설치

```bash
cp launchd/com.mavai.daily.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mavai.daily.plist
launchctl list | grep mavai
```

## 즉시 한 번 돌려보기

```bash
# 분산 모드 (다음 차례 1개만)
launchctl kickstart gui/$(id -u)/com.mavai.daily

# 또는 모든 작업 한 번에 (수동)
cd ~/Desktop/mav-ai && npx tsx scripts/run-tracked.ts
```

로그는 `launchd/run-tracked.out.log` / `run-tracked.err.log` 에 누적됩니다.

## 잠깐 멈추기 / 영구 해제

```bash
# 일시 정지
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.mavai.daily.plist

# 완전 제거
rm ~/Library/LaunchAgents/com.mavai.daily.plist
```

## 동작

- 매 10분마다 launchd가 `run-tracked.ts --next` 호출
- `Watch (active=true)` + `ShellChannel (active=true)` 합쳐서 **lastRunAt이 가장 오래된 작업 1개**만 실행 후 종료
- ad watch 1건 = ATC 도메인 scrape + content.js 추출 + AdStat 스냅샷 (~3-5분)
- shell channel 1건 = YouTube uploads pull + stats refresh + AdStat 스냅샷 (~10초)
- 9개 active 작업이면 ~90분에 모두 한 번씩 갱신

## 주의

- 랩톱이 잠자기 모드면 trigger를 놓침 (잠자기 끝나면 자동 재개)
- ATC가 bot challenge (302 → /sorry/) 때리면 그 1건만 실패하고 다음 tick에서 재시도
- SearchSuggestions은 24h 디스크 캐시(`cache/suggestions/`)로 호출 횟수 ~90% 감소
