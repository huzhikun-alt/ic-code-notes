@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
set PORT=8710
set "URL=http://127.0.0.1:%PORT%/"

echo.
echo   IC Code Notes - local launcher
echo   ----------------------------------------
echo   dir : %cd%
echo   url : %URL%
echo   close this window to stop the server
echo.

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY ( where python >nul 2>nul && set "PY=python" )
if not defined PY ( where python3 >nul 2>nul && set "PY=python3" )

if defined PY (
  echo   [1/2] starting python static server...
  start "" cmd /c "timeout /t 2 >nul & start %URL%"
  %PY% -m http.server %PORT% --bind 127.0.0.1
  goto done
)

where powershell >nul 2>nul
if %errorlevel%==0 (
  echo   [1/2] python not found, using built-in powershell server...
  start "" cmd /c "timeout /t 2 >nul & start %URL%"
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port %PORT%
  goto done
)

echo   [ERROR] neither Python nor PowerShell was found.
echo   You can still double-click index.html, but an intranet API may block CORS.
echo.

:done
echo.
echo   server stopped.
pause
