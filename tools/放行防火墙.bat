@echo off
REM ============================================================
REM  ASCII-only trampoline (see the note in the launcher .bat).
REM  Chinese output lives in tools\firewall.ps1.
REM ============================================================
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\firewall.ps1"
exit /b 0
