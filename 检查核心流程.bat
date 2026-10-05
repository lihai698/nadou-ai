@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "CHECK_PYTHON=%~dp0python\python.exe"
if not exist "%CHECK_PYTHON%" (
    where python >nul 2>nul
    if errorlevel 1 (
        echo 未找到 Python。请恢复项目自带的 python 目录，或安装 Python 3.10 以上版本。
        pause
        exit /b 1
    )
    set "CHECK_PYTHON=python"
)

"%CHECK_PYTHON%" tools\check-core.py
set "CHECK_RESULT=%ERRORLEVEL%"
echo.
if "%CHECK_RESULT%"=="0" (
    echo 核心检查通过。
) else (
    echo 核心检查失败，退出码 %CHECK_RESULT%。请查看上方失败原因。
)
pause
exit /b %CHECK_RESULT%
