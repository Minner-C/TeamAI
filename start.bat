@echo off
rem TeamAI server one-click start script (Windows)
setlocal
cd /d "%~dp0"

echo [teamai] TeamAI server launcher
echo.

rem ---- check Node.js ----
where node >nul 2>nul
if errorlevel 1 goto NO_NODE

for /f "delims=" %%v in ('node -e "const [a,b]=process.versions.node.split('.').map(Number);console.log(a*1000+b>=22005?'ok':'old')"') do set NODE_OK=%%v
if not "%NODE_OK%"=="ok" goto OLD_NODE

rem ---- check pnpm ----
where pnpm >nul 2>nul
if not errorlevel 1 goto PNPM_OK
echo [teamai] pnpm not found, trying corepack...
call corepack enable >nul 2>nul
call corepack prepare pnpm@9.15.0 --activate >nul 2>nul
where pnpm >nul 2>nul
if not errorlevel 1 goto PNPM_OK
echo [teamai] corepack failed, installing pnpm via npm...
call npm install -g pnpm@9
if errorlevel 1 goto NO_PNPM
:PNPM_OK

rem ---- config file ----
if exist .env goto ENV_OK
copy .env.example .env >nul
for /f "delims=" %%i in ('node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set SECRET=%%i
powershell -NoProfile -Command "(Get-Content .env) -replace '^TEAMAI_JWT_SECRET=.*', 'TEAMAI_JWT_SECRET=%SECRET%' | Set-Content .env"
if errorlevel 1 goto ENV_FAIL
echo [teamai] .env created with a random TEAMAI_JWT_SECRET.
echo [teamai] Default admin: admin@teamai.local / admin123 -- please change it after first login.
:ENV_OK

rem ---- install deps ----
if exist node_modules goto DEPS_OK
echo [teamai] First run, installing dependencies...
call pnpm install --frozen-lockfile
if not errorlevel 1 goto DEPS_OK
echo [teamai] Retrying with npmmirror registry...
call pnpm install --registry=https://registry.npmmirror.com
if errorlevel 1 goto INSTALL_FAIL
:DEPS_OK

rem ---- start ----
set PORT=8787
for /f "tokens=2 delims==" %%p in ('findstr /b "TEAMAI_PORT=" .env 2^>nul') do set PORT=%%p
for /f "delims=" %%i in ('node -e "const os=require('os');const n=Object.values(os.networkInterfaces()).flat().find(i=>i&&i.family==='IPv4'&&!i.internal);console.log(n?n.address:'')"') do set LAN_IP=%%i
echo.
echo [teamai] Starting TeamAI server...
echo ==========================================================
echo   Server address (fill this into the client login page):
echo     Local:   http://localhost:%PORT%
if not "%LAN_IP%"=="" echo     LAN:     http://%LAN_IP%:%PORT%
echo   Admin console:  http://localhost:%PORT%/admin
echo   Health check:   http://localhost:%PORT%/health
echo ==========================================================
echo.
call pnpm --filter @teamai/server start
echo.
echo [teamai] Server exited. If it crashed, copy the messages above and send them for troubleshooting.
pause
exit /b 0

:NO_NODE
echo [teamai] ERROR: Node.js not found.
echo [teamai] Please install Node.js 22.5 or newer from https://nodejs.org then REOPEN this window.
pause
exit /b 1

:OLD_NODE
echo [teamai] ERROR: Node.js version too old. TeamAI requires Node.js 22.5 or newer.
node --version
pause
exit /b 1

:NO_PNPM
echo [teamai] ERROR: failed to install pnpm automatically.
echo [teamai] Try running this in a terminal manually:  npm install -g pnpm@9
pause
exit /b 1

:ENV_FAIL
echo [teamai] ERROR: failed to write .env -- try running this script as administrator.
pause
exit /b 1

:INSTALL_FAIL
echo [teamai] ERROR: dependency installation failed. Check your network and retry.
pause
exit /b 1
