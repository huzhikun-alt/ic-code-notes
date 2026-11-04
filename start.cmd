@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PORT=8710

echo.
echo   IC 代码笔记 - 本地启动
echo   ----------------------------------------
echo   目录: %cd%
echo   地址: http://127.0.0.1:%PORT%/
echo   关闭本窗口即停止服务
echo.

rem 先尝试用 Python 起一个静态服务（最省事，且带 no-store 缓存头）
where python >nul 2>nul
if %errorlevel%==0 (
  start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:%PORT%/"
  python -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)

rem 没有 Python 时用内置 PowerShell 服务（无需安装任何东西）
where powershell >nul 2>nul
if %errorlevel%==0 (
  start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:%PORT%/"
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port %PORT%
  goto :eof
)

echo   没有找到 Python 或 PowerShell。
echo   你也可以直接双击 index.html（但调用内网 API 可能被浏览器 CORS 拦截）。
pause
