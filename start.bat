@echo off
REM 微信小程序逆向 MCP Server 启动脚本
REM 使用方法: start.bat [选项]

echo ========================================
echo 微信小程序逆向 MCP Server
echo ========================================
echo.

REM 检查 Node.js 是否安装
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js v20.19.0 或更高版本
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

REM 显示 Node.js 版本
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo [信息] Node.js 版本: %NODE_VERSION%

REM 检查依赖是否安装
if not exist "node_modules" (
    echo [信息] 首次运行，正在安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo [信息] 依赖安装完成
)

REM 构建项目
echo [信息] 正在构建项目...
call npm run build
if %errorlevel% neq 0 (
    echo [错误] 项目构建失败
    pause
    exit /b 1
)

echo [信息] 项目构建完成
echo.

REM 启动 MCP 服务器
echo [信息] 启动微信小程序逆向 MCP Server...
echo [信息] CDP 调试链接: devtools://devtools/bundled/inspector.html?ws=127.0.0.1:62000
echo [信息] 按 Ctrl+C 停止服务器
echo.

node build/src/index.js %*

pause
