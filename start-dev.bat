@echo off
REM ============================================================
REM  AI Roleplay Engine - development mode launcher (Windows)
REM
REM  Runs the Vite dev server instead of the production build.
REM  Use this when you are editing code (instant hot reload).
REM  For normal playing, use start.bat instead.
REM
REM  NOTE: keep this file pure ASCII (see start.bat for why).
REM ============================================================

chcp 65001 >nul 2>&1
setlocal

cd /d "%~dp0"

where pwsh >nul 2>&1
if not errorlevel 1 goto usepwsh

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Dev %*
goto done

:usepwsh
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Dev %*
goto done

:done
if errorlevel 1 (
    echo.
    echo   Launcher exited with an error. See the messages above.
    echo.
    pause
)

endlocal
