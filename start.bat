@echo off
rem TeamAI 服务端一键启动脚本（Windows）
setlocal
cd /d "%~dp0"

rem ---- 环境检查 ----
where node >nul 2>nul
if errorlevel 1 (
  echo [teamai] 错误：未检测到 Node.js，请先安装 Node.js ^>= 22.5（https://nodejs.org）
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [teamai] 未检测到 pnpm，尝试通过 corepack 启用…
  call corepack enable >nul 2>nul
  call corepack prepare pnpm@9.15.0 --activate >nul 2>nul
  where pnpm >nul 2>nul
  if errorlevel 1 call npm install -g pnpm@9
)

rem ---- 配置文件 ----
if not exist .env (
  copy .env.example .env >nul
  for /f "delims=" %%i in ('node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set SECRET=%%i
  powershell -NoProfile -Command "(Get-Content .env) -replace '^TEAMAI_JWT_SECRET=.*', 'TEAMAI_JWT_SECRET=%SECRET%' | Set-Content .env"
  echo [teamai] 已生成 .env 并写入随机 JWT 密钥（管理员账号见 .env，请尽快修改默认密码）
)

rem ---- 依赖安装 ----
if not exist node_modules (
  echo [teamai] 首次运行，安装依赖…
  call pnpm install --frozen-lockfile
  if errorlevel 1 call pnpm install
)

rem ---- 启动 ----
echo [teamai] 启动 TeamAI 服务端…
echo [teamai] 管理控制台： http://localhost:8787/admin
echo [teamai] 健康检查：   http://localhost:8787/health
call pnpm --filter @teamai/server start
endlocal
