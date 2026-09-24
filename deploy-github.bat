@echo off
REM ============================================================
REM  ASCII-only trampoline.
REM  Do NOT put non-ASCII text in this file: cmd.exe reads batch
REM  files by byte offset, and multi-byte characters can be split
REM  mid-character, corrupting the following line.
REM  All Chinese output lives in tools\deploy.ps1 instead.
REM ============================================================
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools\deploy.ps1"
exit /b 0
