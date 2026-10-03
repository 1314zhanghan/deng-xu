@echo off
REM ============================================================
REM  AI Roleplay Engine - one-click launcher (Windows)
REM  Double-click this file. All real logic lives in start.ps1.
REM
REM  NOTE: keep this file pure ASCII.
REM  cmd.exe reads a .bat byte-by-byte using the *current* code page,
REM  and chcp only takes effect after parsing has begun. Non-ASCII
REM  characters here would desync the parser and break the script.
REM  All Chinese user-facing text is printed by start.ps1 instead.
REM ============================================================

chcp 65001 >nul 2>&1
setlocal

cd /d "%~dp0"

where pwsh >nul 2>&1
if not errorlevel 1 goto usepwsh

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
goto done

:usepwsh
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
goto done

:done
if errorlevel 1 (
    echo.
    echo   Launcher exited with an error. See the messages above.
    echo.
    pause
)

endlocal
