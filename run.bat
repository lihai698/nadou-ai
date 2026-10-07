@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem The bundled Python uses python310._pth and does not add the project root.
rem Keep the application package importable when launching from this script.
set "PYTHONPATH=%~dp0;%PYTHONPATH%"

set "PYEXE=%~dp0python\python.exe"
if not exist "%PYEXE%" (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Python was not found. Install Python 3.10 or restore the bundled python folder.
        pause
        exit /b 1
    )
    set "PYEXE=python"
)

rem Install dependencies on the first launch or after the lock file/Python changes.
"%PYEXE%" tools\dependency_marker.py --check >nul 2>&1
if errorlevel 1 (
    echo First launch: installing Python dependencies...
    call "%~dp0安装依赖.bat" --no-pause
    if errorlevel 1 (
        echo Dependency installation failed. Run 安装依赖.bat to see the full error.
        pause
        exit /b 1
    )
)

"%PYEXE%" tools\check-environment.py
if errorlevel 1 (
    echo Environment check failed. Fix the message above and try again.
    pause
    exit /b 1
)

echo Starting nadou ai...
echo Visit: http://127.0.0.1:3000/
echo Press Ctrl+C to stop.
echo.

if /i not "%~1"=="--no-browser" start /b cmd /c "timeout /t 3 /nobreak >nul && start http://127.0.0.1:3000/"
"%PYEXE%" main.py

echo.
echo Server stopped.
pause
