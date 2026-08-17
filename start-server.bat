@echo off
cd /d "%~dp0server"

set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe"
if not exist "%NODE%" set "NODE=node"

:: 端口优先级：命令行参数 > 已存在的 PORT 环境变量 > 默认值 18789
:: 改端口方式一（推荐）：start-server.bat 9000
:: 改端口方式二：set PORT=9000 后再双击本文件
if not "%~1"=="" set "PORT=%~1"
if "%PORT%"=="" set "PORT=18789"

echo 正在启动功能网页后台 (Hono) 端口 %PORT% ...
"%NODE%" index.js
pause
