@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (set "NODE=node") else (set "NODE=%ProgramFiles%\nodejs\node.exe")
start "" http://127.0.0.1:8790
"%NODE%" server.js
pause
