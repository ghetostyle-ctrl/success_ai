<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 마브AI 에이전트 지침

## 한 줄 원칙

LLM은 비싸고 예측 불가능한 친구다. 작은 박스 안에 가둬 놓고, 박스 바깥의 도구, 스크립트, DB, 규칙으로 반복 가능한 모든 걸 빼라.

## 작업 원칙

- LLM에는 `A/B 선택`, `변경 여부 판정`, `리포트 해석`처럼 작은 판단만 맡긴다.
- 같은 작업이 두 번째 나오면 함수, 스크립트, API, DB, 스케줄러로 빼는 신호다.
- 새 도구를 만들면 문서에는 `도구 이름`, `용도`, `언제 호출하는지`만 남기고 구현 디테일은 코드와 테스트에 둔다.
- 데이터가 지저분하면 LLM에 던지지 말고 normalize 도구를 먼저 만든다.
- 한 번 판정한 항목은 DB에 저장해서 다음 실행에서 다시 판정하지 않는다.
- 크롤링은 `Discovery`(구조 탐색/리포트)와 `Execution`(규칙 기반 실행)으로 분리한다.
- 검증은 대표 1건 성공이 아니라 날짜 필터, 페이지네이션, 무한 스크롤, 광고주별 전체 수집 정확성까지 본다.
- API 키와 인증정보는 채팅이나 git에 넣지 않는다. 노출된 키는 삭제가 아니라 재발급한다.
- 애매한 수정은 임시방편보다 본질적으로 맞는 구조를 우선 검토한다.

## 프로젝트 인덱스

- 설치/운영은 README.md 와 SETUP.md 참고
- Next.js 앱/API/UI: `src/AGENTS.md`
- 탐색/백필/운영 스크립트: `scripts/AGENTS.md`
- DB 스키마/마이그레이션: `prisma/AGENTS.md`
- launchd 자동 실행: `launchd/AGENTS.md`

