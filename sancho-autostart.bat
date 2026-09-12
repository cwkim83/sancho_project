@echo off
rem Windows startup launcher (used by the Startup-folder shortcut): same as sancho.bat, but does not open the browser.
set SANCHO_NO_BROWSER=1
call "%~dp0sancho.bat"
