@echo off
rem Windows startup launcher (used by the Startup-folder shortcut): same as sancho.bat, but does not open the browser.
rem Everything is written to data\autostart.log. Reason: this runs in a HIDDEN console, so when it dies there is
rem no window left to read - on 2026-09-16 06:16 Windows closed this cmd.exe as "not responding" and Sancho went
rem away overnight with zero evidence anywhere. The log is the evidence. (ASCII only: cmd misreads UTF-8 Korean.)
set SANCHO_NO_BROWSER=1
set "LOG=%~dp0data\autostart.log"
echo.>>"%LOG%"
echo ===== launcher start %date% %time% >>"%LOG%"
call "%~dp0sancho.bat" >>"%LOG%" 2>&1
echo ===== launcher exit code %errorlevel% at %date% %time% >>"%LOG%"
