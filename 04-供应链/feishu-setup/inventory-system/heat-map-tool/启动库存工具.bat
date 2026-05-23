@echo off
chcp 65001 >nul
title Ultra 车房库存管理

echo.
echo   Ultra 车房库存管理工具
echo   ========================
echo.

set "TOOL_DIR=%~dp0"
set "NODE_DIR=%TOOL_DIR%.node"

:: ─── 1. Node.js ─────────────────────────────
where node >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Node.js 已安装
    for /f "delims=" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
    echo      版本: %NODE_VER%
    goto :check_lark
)

if exist "%NODE_DIR%\node-v20.18.0-win-x64\node.exe" (
    set "PATH=%NODE_DIR%\node-v20.18.0-win-x64;%PATH%"
    echo [OK] Node.js 已就绪（便携版）
    goto :check_lark
)

echo [1/3] 首次运行，正在下载 Node.js（约30MB，请稍候）...
mkdir "%NODE_DIR%" 2>nul
curl -L --progress-bar -o "%NODE_DIR%\node.zip" "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip"
if %errorlevel% neq 0 (
    echo 下载失败，请检查网络连接或手动下载:
    echo https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip
    pause
    exit /b 1
)
echo [2/3] 正在解压...
powershell -Command "Expand-Archive -Path '%NODE_DIR%\node.zip' -DestinationPath '%NODE_DIR%' -Force"
del "%NODE_DIR%\node.zip"
set "PATH=%NODE_DIR%\node-v20.18.0-win-x64;%PATH%"
echo [OK] Node.js 已就绪

:: ─── 2. lark-cli ────────────────────────────
:check_lark
where lark-cli >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] lark-cli 已安装
    for /f "delims=" %%v in ('lark-cli --version 2^>nul') do set LARK_VER=%%v
    echo      版本: %LARK_VER%
    goto :check_port
)

echo [3/3] 正在安装 lark-cli...
echo （可能需要几分钟，请耐心等待）
call npm install -g @larksuite/cli
if %errorlevel% neq 0 (
    echo.
    echo ========================================
    echo   安装失败！请尝试以下步骤：
    echo   1. 关闭此窗口
    echo   2. 右键点击此文件 → 以管理员身份运行
    echo   3. 或手动打开命令行运行：
    echo      npm install -g @larksuite/cli
    echo ========================================
    pause
    exit /b 1
)
echo [OK] lark-cli 已安装

:: ─── 3. 端口检查 ────────────────────────────
:check_port
echo.
echo 检查端口占用...
netstat -ano | findstr ":3456" >nul 2>&1
if %errorlevel% equ 0 (
    echo 警告: 端口 3456 可能被占用，尝试释放...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3456"') do (
        taskkill /f /pid %%a >nul 2>&1
    )
    timeout /t 1 /nobreak >nul
)

:: ─── 4. 飞书登录检查 ────────────────────────────
:start
echo.
echo 检查飞书登录状态...
lark-cli auth status >nul 2>&1
if %errorlevel% neq 0 (
    echo [需要登录] 首次使用需要登录飞书（只需一次）
    echo ========================================
    echo   请在弹出的浏览器中完成授权
    echo   如果浏览器没有自动打开，请手动访问:
    echo   https://applink.feishu.cn/client/link_token/
    echo ========================================
    echo.
    echo 正在打开飞书登录页面...
    lark-cli auth login --domain base
    if %errorlevel% neq 0 (
        echo.
        echo ========================================
        echo   ❌ 登录失败！请检查：
        echo   1. 网络连接正常
        echo   2. 使用公司飞书账号登录
        echo   3. 浏览器弹窗没有被拦截
        echo   4. 尝试右键点击此文件 → 以管理员身份运行
        echo ========================================
        pause
        exit /b 1
    )
    echo [OK] 飞书登录成功
) else (
    echo [OK] 飞书登录状态正常
)

:: ─── 5. 启动服务 ────────────────────────────
echo.
echo ========================================
echo   正在启动库存管理工具...
echo   浏览器将在 3 秒后自动打开
echo   关闭此窗口即可停止服务
echo ========================================
echo.

cd /d "%TOOL_DIR%"

echo 正在启动服务器...
node server.js
if %errorlevel% neq 0 (
    echo.
    echo ========================================
    echo   服务器启动失败！错误码: %errorlevel%
    echo   可能原因：
    echo   1. Node.js 版本不兼容
    echo   2. lark-cli 认证失效，请重新登录
    echo   3. 飞书 Base 权限问题
    echo ========================================
)

pause
