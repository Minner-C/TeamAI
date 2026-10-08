@echo off
rem TeamAI server one-click start script (Windows)
setlocal
cd /d "%~dp0"

rem ---- check Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  echo [teamai] ERROR: Node.js not found. Please install Node.js 22.5 or newer from https://nodejs.org
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -e "const [a,b]=process.versions.node.split('.').map(Number);console.log(a*1000+b>=22005?'ok':'old')"') do set NODE_OK=%%v
if not "%NODE_OK%"=="ok" (
  echo [teamai] ERROR: Node.js version too old. TeamAI requires Node.js 22.5 or newer.
  node --version
  pause
  exit /b 1
)

rem ---- check pnpm ----
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [teamai] pnpm not found, trying corepack...
  call corepack enable >nul 2>nul
  call corepack prepare pnpm@9.15.0 --activate >nul 2>nul
  where pnpm >nul 2>nul
  if errorlevel 1 call npm install -g pnpm@9
)

rem ---- config file ----
if not exist .env (
  copy .env.example .env >nul
  for /f "delims=" %%i in ('node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set SECRET=%%i
  powershell -NoProfile -Command "(Get-Content .env) -replace '^TEAMAI_JWT_SECRET=.*', 'TEAMAI_JWT_SECRET=%SECRET%' | Set-Content .env"
  echo [teamai] .env created with a random TEAMAI_JWT_SECRET.
  echo [teamai] Default admin: admin@teamai.local / admin123 -- please change it after first login.
)

rem ---- install deps ----
if not exist node_modules (
  echo [teamai] First run, installing dependencies...
  call pnpm install --frozen-lockfile
  if errorlevel 1 call pnpm install
)

rem ---- start ----
echo [teamai] Starting TeamAI server...
echo [teamai] Admin console:  http://localhost:8787/admin
echo [teamai] Health check:   http://localhost:8787/health
call pnpm --filter @teamai/server start
endlocal
