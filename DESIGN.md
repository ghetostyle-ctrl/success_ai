# Success AI 디자인

스위트 공유 스펙 = `SUITE-DESIGN.md` (AD FACTORY · 키워드와처 · Success AI 공용, v1 2026-09-28).
이 문서는 Success AI에만 해당하는 부분만 적습니다.

## 토큰

- `src/app/suite-tokens.css`: 세 레포가 같은 파일을 그대로 씁니다. 직접 고치지 말고 스위트 쪽에서 바꾼 뒤 복사합니다.
- `src/app/layout.tsx`의 `<html data-app="successai">`가 파랑 accent(`--accent: #2359e6`)를 고릅니다.
- `src/app/globals.css`
  - `:root`의 `--bg-base`, `--text-primary` 같은 옛 이름은 스위트 토큰의 alias입니다. 새 코드는 테마 유틸리티(`bg-surface`, `text-muted`, `border-line` …)를 씁니다.
  - `@theme inline`이 스위트 토큰을 Tailwind 유틸리티로 연결합니다 (`bg-accent`, `text-success`, `rounded-panel`, `shadow-popover`, `text-page` 등).
  - `@layer components`에 공용 클래스가 있습니다: `.btn*`, `.badge*`, `.panel*`, `.chip`, `.segmented`, `.notice*`, `.field-input`, `.nav-item`, `.sidebar*`, `.topbar`, `.page-heading`, `.empty`, `.progress`.

## 주의

- suite 토큰이 Tailwind 기본 이름 일부를 덮어씁니다: `text-sm` 13px, `text-base` 14px, `text-lg` 16px, `rounded-xs` 4px, `rounded-sm` 6px, `rounded-lg` 14px. `rounded-lg`, `rounded-md`, `rounded-xl`은 쓰지 않고 `rounded-sm`(컨트롤) / `rounded-panel`(패널·카드) / `rounded-dialog`를 씁니다.
- 아이콘은 `lucide-react`만 씁니다 (기본 16px, `strokeWidth={1.75}`, 장식 아이콘은 `aria-hidden`). UI 자리에 이모지를 쓰지 않습니다.
- 12px 미만 글자, `font-bold` 이상 굵기, 그라디언트, 패널 그림자는 쓰지 않습니다.
- 사이드바(`.sidebar`) 안에서는 `--accent` 대신 `--accent-on-dark`, 의미색은 `--sidebar-success` / `--sidebar-danger`를 씁니다.
- 동적 클래스 조합(`hover:${x}`)을 만들지 않습니다. 조건부 클래스는 완전한 문자열 중 하나를 고릅니다 (Tailwind JIT).
- 차트(`DashboardView`)는 `getComputedStyle`로 `--accent`, `--line`, `--muted`, `--surface`, `--ink`를 읽습니다. 보조 시리즈 팔레트와 태그 해시 점 색(`TAG_PALETTE`)만 헥스 상수로 남깁니다.
