# TeamAI 服务端一体化镜像（API + 管理控制台 + Git 托管 + 在线环境）
FROM node:22-bookworm

# git：smart HTTP 仓库托管；util-linux：在线环境 Web 终端的 PTY（script 命令）
RUN apt-get update \
  && apt-get install -y --no-install-recommends git util-linux \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# 仅复制服务端所需的 workspace 包，最大化利用镜像层缓存
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/server ./apps/server

RUN pnpm install --frozen-lockfile --filter @teamai/server...

ENV NODE_ENV=production \
    TEAMAI_HOST=0.0.0.0 \
    TEAMAI_PORT=8787 \
    TEAMAI_DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.TEAMAI_PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@teamai/server", "start"]
