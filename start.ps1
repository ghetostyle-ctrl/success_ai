# Success AI 개발 서버 실행 + 브라우저 열기
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path ".env.local")) { Write-Host ".env.local 이 없습니다. 먼저 .\install.ps1 을 실행하세요." -ForegroundColor Red; exit 1 }
Start-Job -ScriptBlock { Start-Sleep 6; Start-Process "http://localhost:3000" } | Out-Null
npm run dev
