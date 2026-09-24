# 저장한 광고 레퍼런스 내보내기

`GET /api/references/export`는 Success AI에 이미 저장된 자료를 다른 로컬 도구로 전달할 때 쓰는 읽기 전용 API입니다. 수집·통계 갱신·영상 해부·외부 요청·DB 변경을 실행하지 않습니다.

- 저장한 브랜드 선택: `?platform=google&keyword=올리브영&limit=20`
- 저장한 광고 선택: `?platform=meta&ids=123456789,987654321`
- `platform`은 `meta` 또는 `google`입니다. `keyword`는 저장된 키워드와 정확히 일치해야 합니다. ID는 Meta 광고 라이브러리 ID 또는 Google creative ID입니다.
- 키워드 조회는 기본 20건, 최대 100건이며 최근 저장 변경일 내림차순, 동일 날짜에서는 광고 ID 오름차순입니다. ID 조회는 요청 순서를 유지합니다. 두 선택 방법은 함께 사용할 수 없습니다.

응답은 `{ schemaVersion: 1, exportedAt, items }` JSON입니다. 각 item은 `kind: "reference"`, `title`, 실제 저장된 문구와 기존 음성 전사인 `content`, 공식 광고 URL인 `url`, `evidence: "observed"`, `status: "eligible"`, `provenance`, `referenceData`를 포함합니다. `provenance.externalId`는 `meta:<광고 ID>` 또는 `google:<creative ID>`로 유지됩니다. `capturedAt`은 해당 광고와 포함된 전사 자료의 가장 최근 저장 변경 시각입니다. `exportedAt`은 이번 내보내기 시각입니다.

`referenceData`에는 플랫폼, 광고주 이름, 제목·본문 배열, 이미 저장된 Google 광고의 완료된 Whisper 전사 구간, 미디어 링크, 출처와 관측 시각이 붙은 공개 신호만 있습니다. Meta 미디어 썸네일은 이미지로, 스냅샷은 미리보기로 구분합니다. 랜딩 페이지에서 발견한 YouTube 영상을 Meta 광고 영상이나 전사로 간주하지 않습니다. 저장된 본문이나 전사가 없으면 `content`는 빈 문자열입니다. 제목이나 URL만으로 광고 내용을 만들어 넣지 않습니다.

조회수·좋아요·댓글은 YouTube 공개 영상 수치이며 광고 전환·매출 성과가 아닙니다. Meta 변형 개수나 게재 기간도 관측 사실일 뿐 성과 판정이 아닙니다. CTR, ROAS, 비용, 구매 수, 성공 점수는 제공하지 않습니다. Google `first_seen`/`last_seen` 값은 수집 원본의 Unix 초 문자열입니다. `observedAt: null`은 관측 시각을 알 수 없다는 뜻입니다.

잘못된 선택은 400, 저장된 자료가 없거나 선택 ID 일부가 없으면 404입니다. 손상된 저장 문구·전사 시간은 422로 반환합니다. 자료가 가져오기 한도(전체 500,000자, 본문 20,000자, 전사 500구간 또는 개별 필드 한도)를 넘으면 413이며 조용히 잘라내지 않습니다. 응답은 캐시하지 않습니다. 파일로 저장한 JSON은 Meta Ad Studio의 프로젝트 자료 가져오기에 사용할 수 있습니다.

검증: `node --import tsx --test src/lib/reference-export.test.ts src/lib/reference-export.integration.test.ts`. 통합 검증은 임시 SQLite 파일만 만들고 종료 시 정리합니다.

기본 `start.ps1` 실행 방식은 그대로입니다. IPv4의 3000 포트를 다른 앱이 쓰는 경우 `.\start.ps1 -Hostname ::1`로 IPv6 루프백에 실행할 수 있습니다. 서버의 기존 자동 작업 정리 기능도 멈춰야 하는 읽기 전용 검증에서는 실행 프로세스에만 `$env:SUCCESS_AI_JOB_CLEANUP = "0"`을 설정한 뒤 실행하세요. 이 설정은 시작 시와 10분마다 실행되는 기존 작업 상태 정리를 생략하며, 앱의 다른 쓰기 API를 잠그는 설정은 아닙니다. IPv6의 명확한 연결 주소는 `http://[::1]:3000`입니다.
