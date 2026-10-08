@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0..\..\.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_openai_codex_cli.ps1" %*
set "codex_exit_code=%errorlevel%"
echo.
echo Codex CLI exited with code %codex_exit_code%.
pause
exit /b %codex_exit_code%
