' Runs sancho-autostart.bat with NO console window, and waits for it.
' Why a .vbs: Task Scheduler must keep watching a process that stays alive, so it can restart Sancho when it dies.
' A plain cmd.exe action would do that but flashes a black window at every logon; Start-Process would detach and
' the scheduler would think the task already finished. WScript.Shell.Run(cmd, 0, True) = hidden AND waits.
' ASCII only.
Dim sh, here, rc
Set sh = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
rc = sh.Run("""" & here & "sancho-autostart.bat""", 0, True)
WScript.Quit rc
