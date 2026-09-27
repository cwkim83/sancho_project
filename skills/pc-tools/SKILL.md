---
name: pc-tools
description: 이 Windows PC 를 다룰 때 쓴다 — 클립보드 읽기/쓰기, 화면 캡처해서 보기, 알림 띄우기, 앱·파일·URL 열기, 시스템 상태(디스크·메모리·배터리), HWPX(한글) 읽기. 주인이 "클립보드에 뭐 있어", "화면 캡처해서 봐", "알림 띄워", "메모장 열어", "이 hwpx 읽어" 라고 하면 이 스킬.
---

# PC 도구 (Windows · PowerShell)

전부 **명령 실행 권한**이 있어야 한다. 꺼져 있으면 주인에게 권한 메뉴에서 "명령 실행 허용"을 켜달라고 말한다. 명령은 PowerShell 도구(또는 Bash 에서 `powershell -NoProfile -Command "…"`)로 실행한다.

| 할 일 | 방법 |
|---|---|
| 클립보드 글 읽기 | `Get-Clipboard` |
| 클립보드에 글 넣기 | `Set-Clipboard -Value "내용"` |
| 클립보드 이미지 저장 | `Add-Type -AssemblyName System.Windows.Forms; $i=[Windows.Forms.Clipboard]::GetImage(); if($i){$i.Save("파일함\클립보드.png")}` → Read 로 본다 |
| 화면 캡처 | `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object Drawing.Bitmap $b.Width,$b.Height; $g=[Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size); $bmp.Save("파일함\캡처_$(Get-Date -Format HHmmss).png")` → Read 로 본다(이미지 이해 가능) |
| 알림 띄우기 | `(New-Object -ComObject WScript.Shell).Popup("내용", 10, "산초")` (10초 뒤 자동으로 닫힘) |
| 앱·파일·URL 열기 | `Start-Process notepad`, `Start-Process "C:\경로\파일.xlsx"`, `Start-Process "https://…"` |
| 디스크·메모리 | `Get-PSDrive C | Select Used,Free` · `Get-CimInstance Win32_OperatingSystem | Select FreePhysicalMemory,TotalVisibleMemorySize` |
| 배터리 | `(Get-CimInstance Win32_Battery).EstimatedChargeRemaining` |
| 실행 중인 프로그램 | `Get-Process | Sort CPU -Descending | Select -First 10 Name,CPU,WorkingSet` |
| HWPX(한글) 읽기 | HWPX 는 zip 이다: Python 으로 `zipfile` 열고 `Contents/section*.xml` 의 텍스트를 태그 제거해 읽는다. `.hwp`(옛 형식)는 못 읽는다 — 주인에게 hwpx 나 pdf 로 저장해 달라고 한다 |

- 캡처·클립보드 이미지는 산초 데이터 폴더의 `파일함/` 에 저장하고, 본 뒤에는 필요 없으면 지운다.
- 파괴적인 일(파일 삭제, 프로그램 종료, 설정 변경)은 실행 전에 주인에게 확인한다.
