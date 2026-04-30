@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 启动卡坦岛本地服务器 ...
echo.

where python >nul 2>&1
if %ERRORLEVEL% == 0 (
  start "" http://localhost:8765/
  python -m http.server 8765
  goto :end
)

where py >nul 2>&1
if %ERRORLEVEL% == 0 (
  start "" http://localhost:8765/
  py -m http.server 8765
  goto :end
)

where node >nul 2>&1
if %ERRORLEVEL% == 0 (
  start "" http://localhost:8765/
  npx --yes http-server -p 8765 -c-1 .
  goto :end
)

echo [错误] 未找到 python 或 node,无法启动本地服务器。
echo 请手动安装 Python 3 或 Node.js,或使用 Firefox 直接打开 index.html。
pause

:end
