#!/usr/bin/env bash
# TeamAI 服务端一键启动脚本（Linux / macOS）
# 用法：./start.sh           裸机启动（自动装依赖、生成 .env）
#       ./start.sh --docker  使用 Docker Compose 启动
set -e
cd "$(dirname "$0")"

info() { printf '\033[36m[teamai]\033[0m %s\n' "$1"; }
fail() { printf '\033[31m[teamai] 错误：%s\033[0m\n' "$1" >&2; exit 1; }

# ---- Docker 模式 ----
if [ "$1" = "--docker" ]; then
  command -v docker >/dev/null 2>&1 || fail "未检测到 docker，请先安装 Docker 或去掉 --docker 参数裸机启动"
  if [ ! -f .env ]; then
    cp .env.example .env
    SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || openssl rand -hex 32)
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/^TEAMAI_JWT_SECRET=.*/TEAMAI_JWT_SECRET=$SECRET/" .env
    else
      sed -i "s/^TEAMAI_JWT_SECRET=.*/TEAMAI_JWT_SECRET=$SECRET/" .env
    fi
    info "已生成 .env 并写入随机 JWT 密钥"
  fi
  info "使用 Docker Compose 启动…"
  docker compose up -d --build
  info "完成。管理控制台：http://localhost:${TEAMAI_PORT:-8787}/admin （账号见 .env）"
  exit 0
fi

# ---- 环境检查 ----
command -v node >/dev/null 2>&1 || fail "未检测到 Node.js，请先安装 Node.js >= 22.5（https://nodejs.org）"
NODE_VER=$(node -e "const [a,b]=process.versions.node.split('.').map(Number);console.log(a*1000+b)")
[ "$NODE_VER" -ge 22005 ] || fail "Node.js 版本过低（需要 >= 22.5，当前 $(node --version)）"

if ! command -v pnpm >/dev/null 2>&1; then
  info "未检测到 pnpm，尝试通过 corepack 启用…"
  corepack enable 2>/dev/null && corepack prepare pnpm@9.15.0 --activate 2>/dev/null || npm install -g pnpm@9
fi

# ---- 配置文件 ----
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/^TEAMAI_JWT_SECRET=.*/TEAMAI_JWT_SECRET=$SECRET/" .env
  else
    sed -i "s/^TEAMAI_JWT_SECRET=.*/TEAMAI_JWT_SECRET=$SECRET/" .env
  fi
  info "已生成 .env 并写入随机 JWT 密钥（管理员账号见 .env，请尽快修改默认密码）"
fi

# ---- 依赖安装 ----
if [ ! -d node_modules ]; then
  info "首次运行，安装依赖…"
  pnpm install --frozen-lockfile || pnpm install
fi

# ---- 启动 ----
set -a; . ./.env; set +a
PORT=${TEAMAI_PORT:-8787}
info "启动 TeamAI 服务端…"
info "管理控制台： http://localhost:$PORT/admin"
info "健康检查：   http://localhost:$PORT/health"
info "管理员账号： ${TEAMAI_ADMIN_EMAIL:-admin@teamai.local}（密码见 .env，首次登录后请修改）"
exec pnpm --filter @teamai/server start
