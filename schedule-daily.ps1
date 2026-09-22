<#
.SYNOPSIS
  Windows 작업 스케줄러에 "매일 새벽 3시 자동 수집" 등록/해제
  (macOS 의 launchd/ 폴더와 같은 역할)

.EXAMPLE
  .\schedule-daily.ps1              # 등록 (기본 03:00)
  .\schedule-daily.ps1 -At 04:30    # 시각 변경
  .\schedule-daily.ps1 -Unregister  # 해제
  .\schedule-daily.ps1 -RunNow      # 지금 한 번 실행해 보기
#>
param(
  [string]$At = "03:00",
  [switch]$Unregister,
  [switch]$RunNow
)
$TaskName = "SuccessAI-DailyCollect"
$ProjectDir = $PSScriptRoot
$LogDir = Join-Path $ProjectDir "logs"
New-Item -ItemType Directory -Force $LogDir | Out-Null

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "해제됨: $TaskName"
  exit 0
}
if ($RunNow) {
  Set-Location $ProjectDir
  npx tsx scripts/run-tracked.ts
  exit $LASTEXITCODE
}

$npx = (Get-Command npx.cmd -ErrorAction SilentlyContinue).Source
if (-not $npx) { $npx = (Get-Command npx).Source }
$cmd = "cmd.exe"
$args = "/c cd /d `"$ProjectDir`" && `"$npx`" tsx scripts/run-tracked.ts >> `"$LogDir\run-tracked.log`" 2>&1"

$action  = New-ScheduledTaskAction -Execute $cmd -Argument $args -WorkingDirectory $ProjectDir
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Success AI: 추적 중인 브랜드 광고 자동 수집" -Force | Out-Null
Write-Host "등록됨: $TaskName (매일 $At). 로그: $LogDir\run-tracked.log"
Write-Host "PC 가 그 시각에 켜져 있어야 합니다. 꺼져 있었으면 다음 부팅 후 실행됩니다."
