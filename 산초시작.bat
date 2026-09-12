@echo off
rem 산초 실행기. 서버가 75 로 끝나면 다시 켜고(재시작 요청), 비정상 종료면 마지막 정상판(git tag last-good)으로 되돌린다.
rem 메시지는 영문 — cmd 창의 코드페이지에 따라 한글이 깨질 수 있어서.
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
