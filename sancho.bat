@echo off
rem Sancho launcher. ASCII only: cmd misreads UTF-8 Korean in .bat files (2026-09-12).
rem Exit code 75 = restart requested. Any other non-zero exit = crash -> roll back to git tag last-good and start again.
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (set "NODE=node") else (set "NODE=%ProgramFiles%\nodejs\node.exe")
if not defined SANCHO_NO_BROWSER start "" http://127.0.0.1:8790
set FAILS=0

:loop
"%NODE%" server.js
set CODE=%errorlevel%
if %CODE%==75 (
  echo [Sancho] restart requested - starting again...
  goto loop
)
if %CODE%==0 goto end
set /a FAILS+=1
if %FAILS% geq 3 (
  echo [Sancho] crashed 3 times in a row - auto-rollback did not help. See the errors above.
  pause
  goto end
)
echo [Sancho] crashed with code %CODE%. Rolling back to last-good...
git checkout last-good -- . 2>nul
goto loop

:end
