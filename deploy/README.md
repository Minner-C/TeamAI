# TeamAI 部署指南

服务端是一体化进程：API + 管理控制台（`/admin`）+ 内置 Git 托管 + 在线环境。桌面客户端（Electron）单独打包分发，见文末。

## 1. Docker Compose（推荐）

```bash
cp .env.example .env
# 编辑 .env：必须替换 TEAMAI_JWT_SECRET（openssl rand -hex 32）
docker compose up -d --build
```

- 管理控制台：`http://<host>:8787/admin`
- 健康检查：`http://<host>:8787/health`
- 数据持久化在命名卷 `teamai-data`（SQLite / 上传文件 / Git 仓库）

在线环境使用 docker 后端时，编辑 `docker-compose.yml` 挂载 `/var/run/docker.sock` 并设置 `TEAMAI_ENV_RUNNER=docker`。

## 2. 纯 Docker

```bash
docker build -t teamai-server .
docker run -d --name teamai \
  -p 8787:8787 \
  -e TEAMAI_JWT_SECRET="$(openssl rand -hex 32)" \
  -v teamai-data:/data \
  teamai-server
```

## 3. 裸机 / systemd

前置：Node.js ≥ 22.5（依赖 `node:sqlite`）、pnpm 9、git、util-linux（Web 终端 PTY）。

```bash
useradd -r -m -d /opt/teamai teamai
git clone <repo> /opt/teamai && cd /opt/teamai
pnpm install --frozen-lockfile
cp .env.example .env   # 编辑密钥与管理员账号
cp deploy/teamai.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now teamai
```

## 4. 反向代理（可选）

`deploy/nginx.conf` 为参考配置，包含 WebSocket 升级头与 SSE 关缓冲两个关键点；启用 HTTPS 请自行叠加 certbot/证书配置。

## 5. 桌面客户端分发

客户端不随服务端部署，单独打包：

```bash
pnpm --filter @teamai/client dist:win   # Windows NSIS 安装包 + 便携版
# macOS / Linux 目标见 apps/client 的 electron-builder 配置
```

用户在客户端登录页填写服务端地址（如 `https://teamai.example.com`）即可连接。

## 环境变量

见 `.env.example` 注释。生产环境必须覆盖 `TEAMAI_JWT_SECRET` 与默认管理员密码。
