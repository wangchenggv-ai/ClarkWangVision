@echo off
chcp 65001 >nul 2>&1
title Ultra Stock Manager

setlocal enabledelayedexpansion

set "TOOL_DIR=%~dp0"
set "EXCEL_FILE=%TOOL_DIR%stock.xlsx"

echo.
echo ========================================
echo   Ultra Stock Manager
echo ========================================
echo.

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3456" ^| findstr "LISTENING"') do (
    echo Killing process on port 3456...
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

if not exist "%EXCEL_FILE%" (
    echo ERROR: %EXCEL_FILE% not found!
    echo Please put stock.xlsx in this folder
    pause
    exit /b 1
)

echo [OK] Found: %EXCEL_FILE%
echo.

cd /d "%TOOL_DIR%"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not installed!
    echo Download from https://nodejs.org
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js: %NODE_VER%

if not exist "%TOOL_DIR%node_modules" (
    echo.
    echo Installing dependencies...
    call npm install xlsx --silent
    if %errorlevel% neq 0 (
        echo ERROR: npm install failed
        pause
        exit /b 1
    )
)

echo.
echo Starting server...
echo Open: http://localhost:3456
echo.

node server.js

if %errorlevel% neq 0 (
    echo.
    echo Server stopped with error!
)
pause
