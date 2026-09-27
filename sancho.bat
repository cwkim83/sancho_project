@echo off
title Sancho - closing this window stops Sancho
rem Sancho launcher. ASCII only: cmd misreads UTF-8 Korean in .bat files (2026-09-12).
rem Exit code 75 = restart requested. 0 = quit. Anything else = crash.
rem On crash we DO NOT touch the files unless server.js is really broken (syntax check first).
rem   Why: Stop-Process / Task Manager kills also exit non-zero, and the old rollback silently
rem   overwrote newer committed code with the last-good tag - it ate real work twice (2026-09-14/15).
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
  set FAILS=0
  goto loop
)
if %CODE%==0 goto end
set /a FAILS+=1
if %FAILS% geq 3 (
  echo [Sancho] stopped 3 times in a row. See the errors above.
  pause
  goto end
)
rem Is the code itself broken? Only then roll back - and keep a copy of what we replace.
"%NODE%" --check server.js >nul 2>nul
if %errorlevel%==0 (
  echo [Sancho] stopped with code %CODE% - code looks fine, starting again...
  goto loop
)
echo [Sancho] server.js is broken. Saving a copy and rolling back to last-good...
git stash push -u -m "sancho auto-rollback backup" >nul 2>nul
git checkout last-good -- . 2>nul
goto loop

:end
