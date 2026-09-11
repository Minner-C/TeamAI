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
pnpm --filter @teamai/server test:e2e   # 服务端端到端测试（mock 上游，15 项）
```

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
