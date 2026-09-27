# 산초를 윈도 "작업 스케줄러"에 등록한다.
#
# 왜 바꿨나 (2026-09-16):
#   시작프로그램 폴더의 바로가기는 숨은 cmd 창 하나에 산초를 통째로 얹어 두는 방식이라,
#   그 창이 죽으면 아무도 다시 켜 주지 않는다. 실제로 06:16 에 윈도가 그 창을
#   "응답 없음"으로 닫아서 산초가 밤새 꺼져 있었다(이벤트 로그 Application Hang).
#   작업 스케줄러는 죽으면 1분 뒤 다시 켠다 — 그게 이 파일의 존재 이유다.
#
# 쓰는 법: 파워셸에서  powershell -ExecutionPolicy Bypass -File "작업스케줄러-등록.ps1"
#          지우려면    Unregister-ScheduledTask -TaskName Sancho -Confirm:$false

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs  = Join-Path $here 'sancho-hidden.vbs'
if (-not (Test-Path $vbs)) { throw "sancho-hidden.vbs 를 찾지 못했습니다: $vbs" }

$action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo `"$vbs`"" -WorkingDirectory $here
# 방아쇠 둘: (1) 로그온할 때 (2) 2분마다 "살아 있나" 확인.
# (2)가 진짜 안전장치다 — 윈도의 "실패하면 다시 시작" 옵션은 수동 실행이나 강제 종료 때 안 먹는 경우가 있어
# 믿을 수 없다(2026-09-16 시험에서 150초 동안 안 켜짐). 이미 돌고 있으면 MultipleInstances=IgnoreNew 라
# 아무 일도 일어나지 않고, 꺼져 있을 때만 켜진다.
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger2 = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
$princ   = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$set     = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd `
  -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999

Register-ScheduledTask -TaskName 'Sancho' -Action $action -Trigger @($trigger, $trigger2) -Principal $princ -Settings $set `
  -Description '산초 개인 비서 서버. 로그온하면 켜지고, 죽으면 1분 뒤 다시 켠다. 기록: data\autostart.log' -Force | Out-Null

# 시작프로그램 폴더의 옛 바로가기는 비켜 둔다 — 두 군데서 켜면 포트가 겹친다.
$old = Join-Path ([Environment]::GetFolderPath('Startup')) 'Sancho.lnk'
if (Test-Path $old) { Move-Item $old (Join-Path $here 'Sancho-old-startup.lnk.bak') -Force }

Get-ScheduledTask -TaskName 'Sancho' | Select-Object TaskName, State
