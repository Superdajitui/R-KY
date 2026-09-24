@echo off
REM ============================================================
REM  ASCII-only trampoline (see note in the launcher .bat).
REM  Chinese output lives in tools\setup-ssh.ps1.
REM ============================================================
chcp 65001 >nul
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\setup-ssh.ps1"
exit /b 0
