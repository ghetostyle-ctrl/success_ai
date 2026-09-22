<#
.SYNOPSIS
  Success AI 원클릭 설치 (Windows PowerShell 5.1 / 7 모두 동작)

.DESCRIPTION
  1) Node.js 20+ 와 git 확인
  2) 저장소가 없으면 C:\success_ai 로 클론
  3) npm install + Playwright Chromium 설치
  4) .env / .env.local 생성 (없을 때만) 및 YouTube API 키 주입(옵션)
  5) Prisma 클라이언트 생성 + SQLite DB 초기화

.EXAMPLE
  # 저장소 폴더 안에서
  .\install.ps1
  .\install.ps1 -YouTubeApiKey "AIza..."

  # 아무 데서나 (자동 클론)
  irm https://raw.githubusercontent.com/ghetostyle-ctrl/success_ai/main/install.ps1 | iex
#>
param(
  [string]$YouTubeApiKey = "",
  [string]$InstallDir = "C:\success_ai",
  [string]$RepoUrl = "https://github.com/ghetostyle-ctrl/success_ai.git"
)

$ErrorActionPreference = "Stop"
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "`n[실패] $msg" -ForegroundColor Red; exit 1 }

# 1. 필수 도구 확인 -----------------------------------------------------------
Step "Node.js / git 확인"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js 가 없습니다. https://nodejs.org 에서 20 이상 LTS 를 설치한 뒤 다시 실행하세요." }
$ver = [int]((node -v).TrimStart('v').Split('.')[0])
if ($ver -lt 20) { Fail "Node.js $(node -v) 는 너무 낮습니다. 20 이상이 필요합니다." }
Write-Host "  Node $(node -v) OK"

# 2. 프로젝트 폴더 결정 --------------------------------------------------------
$here = Get-Location
if (Test-Path (Join-Path $here "package.json")) {
  $ProjectDir = $here.Path
  Write-Host "  현재 폴더를 프로젝트로 사용: $ProjectDir"
} else {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "git 이 없습니다. https://git-scm.com 에서 설치하세요." }
  if (-not (Test-Path $InstallDir)) {
    Step "저장소 클론 → $InstallDir"
    git clone --depth 1 $RepoUrl $InstallDir
  }
  $ProjectDir = $InstallDir
}
Set-Location $ProjectDir

# 3. 의존성 --------------------------------------------------------------------
Step "npm install (처음 한 번, 2~3분)"
npm install
if ($LASTEXITCODE -ne 0) { Fail "npm install 실패" }

Step "Playwright Chromium 설치 (메타 광고 라이브러리 수집용)"
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { Fail "playwright install 실패" }

# 4. 환경파일 ------------------------------------------------------------------
Step "환경파일 (.env / .env.local)"
foreach ($f in ".env", ".env.local") {
  if (-not (Test-Path $f)) { Copy-Item ".env.example" $f; Write-Host "  $f 생성" }
  else { Write-Host "  $f 이미 있음 (건드리지 않음)" }
  if ($YouTubeApiKey) {
    (Get-Content $f) -replace '^YOUTUBE_API_KEY=.*', "YOUTUBE_API_KEY=$YouTubeApiKey" | Set-Content $f
  }
}
if ($YouTubeApiKey) { Write-Host "  YouTube API 키 주입 완료" }
else { Write-Host "  YouTube API 키는 나중에 .env 와 .env.local 의 YOUTUBE_API_KEY= 뒤에 넣으세요" -ForegroundColor Yellow }

# 5. DB ------------------------------------------------------------------------
Step "Prisma 클라이언트 + SQLite DB 초기화"
npx prisma generate
if ($LASTEXITCODE -ne 0) { Fail "prisma generate 실패" }
npx prisma db push
if ($LASTEXITCODE -ne 0) { Fail "prisma db push 실패 (.env 의 DATABASE_URL 확인)" }

# 6. 바탕화면 바로가기 ---------------------------------------------------------
Step "바탕화면 바로가기 만들기"
try {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $lnk = Join-Path $desktop "Success AI 실행.lnk"
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = "powershell.exe"
  $sc.Arguments = "-NoExit -ExecutionPolicy Bypass -File `"$ProjectDir\start.ps1`""
  $sc.WorkingDirectory = $ProjectDir
  $sc.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
  $sc.Description = "Success AI 서버 실행 + 브라우저 열기"
  $sc.Save()
  Write-Host "  $lnk"
} catch { Write-Host "  바로가기 생성 실패(무시 가능): $($_.Exception.Message)" -ForegroundColor Yellow }

# 7. 선택 도구 안내 ------------------------------------------------------------
if (-not (Get-Command yt-dlp -ErrorAction SilentlyContinue)) {
  Write-Host "`n(선택) 소재 mp4 다운로드를 쓰려면:  winget install yt-dlp.yt-dlp   후 앱 재시작" -ForegroundColor Yellow
}

Write-Host "`n설치 완료. 실행 방법:" -ForegroundColor Green
Write-Host "  1) 바탕화면의 'Success AI 실행' 아이콘 더블클릭   ← 제일 쉬움"
Write-Host "  2) 또는  cd $ProjectDir ; .\start.ps1   →  http://localhost:3000"
Write-Host "매일 자동 수집 등록:  .\schedule-daily.ps1"
