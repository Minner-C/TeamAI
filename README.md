# TeamAI

团队 AI 协作工具：服务端（模型网关 / 用量管理 / 内容存储 / 内置 Git / 团队 IM）+ Windows 桌面客户端（图形化封装成熟 AI CLI）。

架构设计详见 [docs/architecture.md](docs/architecture.md)。

## 目录结构

```
apps/
  server/      服务端（Fastify + TypeScript）
  client/      桌面客户端（Electron + React + Vite，Windows 优先）
packages/
  shared/      前后端共享类型与 WS 协议定义
docs/
  architecture.md
```

## 开发

要求 Node.js >= 20、pnpm 9。

```bash
pnpm install

pnpm dev:server   # 服务端，默认 http://localhost:8787（/health 健康检查）
pnpm dev:client   # 客户端（vite + electron 开发模式）

pnpm typecheck    # 全仓类型检查
pnpm build        # 全仓构建
pnpm --filter @teamai/server test:e2e        # 网关/认证/refresh token/配额端到端（31 项）
pnpm --filter @teamai/server test:e2e:pool   # 网关 Key 池轮询/熔断/降级/成本（16 项）
pnpm --filter @teamai/server test:e2e:im     # IM 端到端（32 项，含 WS 广播/presence/AI 角色）
pnpm --filter @teamai/server test:e2e:git    # Git 托管（23 项，含真实 clone/push/Webhook 验签）
pnpm --filter @teamai/server test:e2e:repos  # 仓库成员权限隔离（25 项）
pnpm --filter @teamai/server test:e2e:envs   # 在线环境 + Web 终端（26 项）
pnpm --filter @teamai/server test:e2e:files  # 文件上传/下载/隔离（19 项）
pnpm --filter @teamai/client test:adapters   # CLI headless 适配器（29 项，mock CLI 端到端）
```

浏览器预览模式：`pnpm dev:server` 后再起 `pnpm --filter @teamai/client exec vite`，访问 http://localhost:5173 可直接登录使用（Vite 代理转发到服务端）；Git 克隆、CLI 检测等本地能力仅在 Electron 中可用。

Git 远程地址格式：`http://<邮箱>:<token>@服务器:8787/git/<分组>/<仓库名>.git`（客户端「项目仓库」页可复制完整克隆命令）。

首次启动服务端会自动创建管理员账号（默认 `admin@teamai.local` / `admin123`，可用下方环境变量覆盖）。

## 环境变量（服务端）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `TEAMAI_PORT` | `8787` | 监听端口 |
| `TEAMAI_DATA_DIR` | `apps/server/data` | 数据目录 |
| `TEAMAI_REPOS_DIR` | `$TEAMAI_DATA_DIR/repos` | bare 仓库目录 |
| `TEAMAI_JWT_SECRET` | dev-only | 生产必须覆盖（同时用于 Key 加密） |
| `TEAMAI_ADMIN_EMAIL` | `admin@teamai.local` | 初始管理员邮箱 |
| `TEAMAI_ADMIN_PASSWORD` | `admin123` | 初始管理员密码 |
| `TEAMAI_ENV_RUNNER` | `auto` | 在线环境后端：`auto`/`process`/`docker`，无 docker 自动降级进程级 |
| `TEAMAI_ENV_IMAGE` | `node:22-alpine` | docker 后端使用的镜像 |
