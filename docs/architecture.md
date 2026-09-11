# TeamAI 系统架构设计

> 版本：v0.1（初稿）  日期：2026-09-11

## 1. 项目概述

TeamAI 是一套面向团队的 AI 协作工具，由**服务端**与**客户端**两部分组成：

- **服务端（TeamAI Server）**：部署在团队服务器上，负责统一接入各家大模型 API（API 网关）、用量管理与配额、内容存储、内置 Git 托管、团队 IM（聊天/群组/AI 角色），以及后续阶段的在线开发环境。
- **客户端（TeamAI Client）**：团队成员使用的桌面 AI Agent 工具（Windows 优先），不自研 Agent，而是复用成熟厂商的 CLI（Kimi Code、Claude Code、Codex CLI、Gemini CLI、Qwen Code 等），参考 [ai-cli-hub](https://github.com/Minner-C/ai-cli-hub) 的模式将 CLI 交互图形化。工作内容通过 Git 与服务端同步，并内置团队聊天/群组功能，聊天内容可一键喂给 AI，群组内可添加 AI 角色参与讨论。

### 1.1 设计原则

1. **服务端是唯一事实源**：模型 Key、用量、聊天、仓库都集中在服务端，客户端是无状态/弱状态的工作台。
2. **不自研 Agent**：复用成熟 CLI，通过 ACP / headless stream-json 协议适配，CLI 未安装不阻塞其他功能。
3. **模型调用必须走服务端网关**：客户端不持有任何真实 API Key，网关统一鉴权、路由、计量、限流。
4. **Git 即同步**：日常工作产物以 Git 仓库形式在客户端与服务端之间同步，天然具备版本与协作能力。
5. **渐进交付**：网关 + IM + Git 为第一优先级，在线环境为后续阶段。

## 2. 总体架构

```
┌────────────────────────────────────────────────────────────┐
│                     团队服务器（TeamAI Server）              │
│                                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ LLM 网关  │  │ 用量管理  │  │ 内容存储  │  │ Git 托管   │  │
│  │ gateway  │  │ usage    │  │ storage  │  │ git       │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │             │             │              │        │
│  ┌────┴─────────────┴─────────────┴──────────────┴─────┐  │
│  │              核心层：认证 / 用户 / 权限 / 审计          │  │
│  └──────────────────────────┬──────────────────────────┘  │
│                             │                             │
│  ┌──────────┐  ┌──────────┐ │ ┌────────────────────────┐  │
│  │ IM 实时层 │  │ AI 角色   │ │ │ 在线环境（Phase 2 预留）  │  │
│  │ (WebSocket)│  │ 引擎     │ │ │ 容器沙箱 orchestration │  │
│  └──────────┘  └──────────┘ │ └────────────────────────┘  │
│                             │                             │
│  存储：SQLite/Postgres + 本地磁盘（bare repos / 附件）        │
└──────────────┬──────────────────────────────┬─────────────┘
               │ HTTP/WebSocket               │ Git Smart HTTP
┌──────────────┴──────────────────────────────┴─────────────┐
│                  团队成员电脑（TeamAI Client / Windows）     │
│                                                            │
│  ┌──────────────── React Renderer ─────────────────────┐  │
│  │  聊天式 Agent UI │ IM 面板 │ 文件/编辑器 │ 用量 │ 设置  │  │
│  └──────────────────────┬───────────────────────────────┘  │
│  ┌──────────────────────┴─────────── Electron Main ────┐  │
│  │  CLI 适配层（ACP / headless stream-json）             │  │
│  │  统一模型注册（模型 → 服务端网关路由，env 注入）         │  │
│  │  Git 工作区（clone/pull/push，任务级工作分支）          │  │
│  │  IM 客户端（WebSocket 长连接，离线缓存）                │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

## 3. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| Monorepo | pnpm workspace | 服务端/客户端/共享包统一管理，类型共享 |
| 服务端框架 | Fastify + TypeScript | 高性能、schema 校验、插件化，生态成熟 |
| 服务端存储 | SQLite（better-sqlite3，WAL）起步，接口抽象后可换 Postgres | 团队规模下单机够用，零运维依赖 |
| 实时通信 | WebSocket（ws 库） | 自研轻量 IM，消息落库 + 在线分发 |
| Git 托管 | `git http-backend`（smart HTTP）+ bare 仓库落盘 | 不引入 Gitea 等重依赖，仓库即目录，备份简单 |
| 对象/文件存储 | 本地磁盘 + 抽象接口 | 后续可换 MinIO/S3 |
| LLM SDK | 官方 SDK（@anthropic-ai/sdk、openai 等）+ OpenAI 兼容端点 | 网关内按 provider 适配 |
| 客户端壳 | Electron（Windows 优先打包） | 与 ai-cli-hub 同栈，能力成熟（safeStorage、通知、进程管理） |
| 客户端 UI | React 18 + Vite + zustand + Ant Design | 聊天/面板类 UI 开发效率高 |
| CLI 适配 | ACP（JSON-RPC over stdio，Kimi）+ headless stream-json（Claude/Codex/Gemini/Qwen） | ai-cli-hub 已验证的双通道模式 |
| 密钥存储 | 客户端 Electron safeStorage（DPAPI）；服务端环境变量 + 加密落库 | 不落地明文 |

## 4. 服务端详细设计

### 4.1 模块划分（`apps/server/src/modules/`）

| 模块 | 职责 |
|---|---|
| `core` | 用户、团队、认证（token/session）、角色权限、审计日志 |
| `gateway` | LLM API 网关：provider 适配、Key 池、路由、流式转发（SSE）、重试与降级 |
| `usage` | 用量计量（按用户/模型/任务）、配额与限额、统计报表 API |
| `storage` | 会话存档、任务记录、消息持久化、附件文件 |
| `git` | bare 仓库生命周期（创建/删除/权限）、smart HTTP 转发、Web 端浏览 API |
| `im` | 单聊/群组、消息收发与历史、已读、群组 AI 角色绑定 |
| `airole` | AI 角色引擎：群内被 @ 或触发词时调用网关生成回复，人设/模型/温度可配 |
| `env` | （Phase 2）在线环境：容器沙箱创建/回收、SSH/Web Terminal 接入 |

### 4.2 LLM 网关

- **统一入口**：`/v1/chat/completions`（OpenAI 兼容）+ `/v1/messages`（Anthropic 兼容）。客户端 CLI 通过环境变量（如 `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`）指向网关，配合网关签发的虚拟 Key。
- **Provider 适配**：Anthropic、OpenAI 兼容系（DeepSeek、GLM、Qwen、Moonshot、OpenRouter）、Gemini。每个 provider 一个 adapter：请求转换 → 上游调用 → 响应/usage 归一化。
- **Key 池**：一个 provider 可配多个上游 Key，轮询 + 失败熔断。
- **计量**：流式与多轮均从响应 usage 提取 token；无 usage 时按估算标记（与 ai-cli-hub 一致，估算值在 UI 标注）。
- **虚拟 Key**：`tk-xxx`，绑定用户与额度，可随时吊销。这是客户端 CLI 唯一可见的"Key"。

### 4.3 用量管理

- 每次网关调用落一条 `usage_records`（用户、模型、provider、输入/输出 token、成本估算、来源 CLI、关联任务/会话）。
- 配额：按用户/团队设置日/月 token 或金额上限，网关调用前预检。
- 报表：按人/模型/项目/时间聚合，供客户端「用量统计」页展示。

### 4.4 内容存储

- 客户端 Agent 会话（任务）结束或定时快照上传到服务端存档（对话 JSONL + 元数据），支持团队内检索与回放。
- 附件（图片/文件）走 `/files` 上传，磁盘存储 + DB 元数据。

### 4.5 Git 托管

- 服务端 `data/repos/<group>/<repo>.git` 存 bare 仓库。
- `git http-backend` 处理 `/git/*` 的 smart HTTP 请求，前置中间件做认证与仓库级权限（读/写）。
- 每个团队成员日常工作流程：客户端从服务端 clone → 任务分支 → push → 服务端可触发 Webhook（后续接 CI/通知）。
- 提供 REST API：仓库列表/创建、commit 历史、分支、文件树/文件内容读取（用 `git log/show` 子进程实现），供客户端"项目"视图使用。

### 4.6 IM（自研轻量）

- **通道**：WebSocket `/ws`，JSON 消息协议（见 `packages/shared/src/protocol.ts`）。
- **模型**：`channels`（dm / group）、`messages`、`channel_members`、`read_states`。
- **消息类型**：text、markdown、code、file、image、`ai_request`（一键喂给 AI 的引用载荷）。
- **AI 角色**：群组可绑定若干 AI 角色（`ai_roles`：名称、人设 prompt、模型、触发方式）。消息落库后，airole 引擎判断是否触发（@角色名 / 触发词 / 自动总结），调用网关生成回复并以角色身份发消息。
- **历史**：REST 分页拉取；WebSocket 只负责实时增量与在线状态。

### 4.7 认证与安全

- 管理员初始化创建团队与用户；登录签发 JWT（access + refresh）。
- 所有 REST/WS/Git 请求统一鉴权中间件；仓库、群组、用量均按角色（admin/member）与成员关系判定。
- 上游真实 API Key 仅存在于服务端（环境变量或加密列），审计日志记录 Key 的增删与虚拟 Key 的签发/吊销。

### 4.8 API 概览（REST，前缀 `/api`）

```
POST /api/auth/login           登录
GET  /api/me                   当前用户
# 网关（客户端 CLI 直连）
POST /v1/chat/completions      OpenAI 兼容（SSE 流式）
POST /v1/messages              Anthropic 兼容（SSE 流式）
# 管理
GET/POST /api/admin/providers  上游 provider 与 Key 池管理
GET/POST /api/admin/keys       虚拟 Key 签发/吊销
GET  /api/usage/summary        用量聚合
GET  /api/usage/records        用量明细
# 存储
POST /api/sessions             会话存档上传
GET  /api/sessions             会话列表/检索
POST /api/files                附件上传
# Git
GET/POST /api/repos            仓库列表/创建
GET  /api/repos/:id/tree       文件树
/git/*                         smart HTTP（clone/push/pull）
# IM
GET  /api/channels             我的会话列表
GET  /api/channels/:id/messages 历史消息
POST /api/channels             创建群组/单聊
GET/POST /api/ai-roles         AI 角色管理
WS   /ws                       实时消息
```

## 5. 客户端详细设计

参考 ai-cli-hub 的目录与进程模型：`electron/` 主进程 + `src/` 渲染进程（React + zustand），contextIsolation 开、nodeIntegration 关，全部 IPC 走类型化 preload 桥。

### 5.1 主进程模块（`apps/client/electron/`）

| 文件 | 职责 |
|---|---|
| `acpClient.ts` | 手写 ACP（JSON-RPC over stdio）客户端，Kimi 长连接 |
| `headlessManager.ts` | Claude/Codex/Gemini/Qwen headless `stream-json` 适配，NDJSON → 统一事件流 |
| `modelRegistry.ts` | 统一模型表：模型 → CLI + 服务端网关端点，env 注入虚拟 Key（不改写 CLI 配置文件） |
| `permissionManager.ts` | 按 CLI 映射权限模式（交互审批 / auto / yolo） |
| `serverClient.ts` | 服务端 REST/WS 封装，token 刷新 |
| `gitWorkspace.ts` | 项目 clone/分支/commit/push，与服务端 Git 托管对接 |
| `imClient.ts` | IM WebSocket 长连接、断线重连、离线消息拉取 |
| `sessionSync.ts` | 会话快照上传服务端存档 |
| `usageReporter.ts` | 本地统计 + 服务端用量页数据拉取 |

### 5.2 渲染进程页面（`apps/client/src/`）

1. **Agent 工作台**：聊天式界面（流式 Markdown、工具调用卡片、diff 视图、可折叠思考流）、任务中切换 CLI（摘要注入新 CLI 首条消息）、权限审批卡片。
2. **IM 面板**：左侧会话列表（单聊/群组），右侧消息流；消息 hover 出现「喂给 AI」按钮 → 将消息（含代码块）作为上下文注入当前/新建 Agent 任务；群设置中可添加/配置 AI 角色。
3. **项目/Git 视图**：服务端仓库列表、clone 到本地、分支与提交历史、任务与分支绑定。
4. **用量统计**：服务端聚合数据 + 本地热力图。
5. **设置**：服务端地址与登录、CLI 检测与一键安装、每 CLI 参数、主题/语言。

### 5.3 CLI 接入矩阵（一期）

| CLI | 通道 | 说明 |
|---|---|---|
| Kimi Code | ACP 长连接（默认）/ headless 兜底 | token 级流式、权限、plan 模式 |
| Claude Code | headless `stream-json` 双向 | 权限走 `--permission-prompt-tool stdio` |
| Codex CLI | headless json | 按公开协议适配 |
| Gemini CLI | headless json | 按公开协议适配 |
| Qwen Code | headless json | 按公开协议适配 |

未安装的 CLI 显示为不可用，不阻塞其余功能；npm 系 CLI 支持一键安装。

### 5.4 模型调用链路

```
渲染层选模型 → modelRegistry 查路由 → spawn CLI（env: BASE_URL=服务端网关, KEY=虚拟Key）
→ CLI 请求服务端网关 → 网关鉴权/配额预检 → provider 适配 → 上游真实 API
→ usage 落库 → SSE 回传 → CLI → 统一事件流 → UI
```

## 6. 数据模型（核心表，SQLite）

```
users(id, name, email, password_hash, role, created_at)
teams / team_members(user_id, team_id, role)
providers(id, type, base_url, keys_enc, enabled)
virtual_keys(id, key, user_id, quota, revoked_at)
usage_records(id, user_id, model, provider, tokens_in, tokens_out, cost, cli, task_id, ts)
sessions(id, user_id, task_id, cli, archive_path, meta_json, created_at)
repos(id, name, group, path, owner_id, created_at)
channels(id, type[dm|group], name, owner_id, created_at)
channel_members(channel_id, user_id)
messages(id, channel_id, sender_user_id|sender_role_id, type, content, payload_json, created_at)
ai_roles(id, name, persona_prompt, model, trigger, channel_id, enabled)
```

## 7. 实施路线图

- **Phase 0（已完成）**：架构文档 + monorepo 脚手架，服务端可启动（健康检查 + 模块目录 + 协议类型），客户端可启动（Electron 壳 + 页面框架）。
- **Phase 1（已完成核心链路）**：服务端 core/auth（scrypt 密码 + HMAC token）+ gateway（OpenAI/Anthropic 兼容转发、SSE 流式透传、跨协议非流式转换、usage 落库）+ usage（聚合/明细 API）+ 虚拟 Key（签发/吊销/配额限流），15 项 e2e 测试全过（`pnpm --filter @teamai/server test:e2e`）；客户端登录 + Agent 页聊天（模型选择 → 网关 → 流式出字）+ CLI 检测 + Claude headless 适配器骨架。待补：Kimi ACP 长连接适配、Claude 权限提示协议接入。
- **Phase 2（已完成核心）**：Git 托管落地——bare 仓库创建/删除、smart HTTP（`git http-backend` CGI 桥接 + Basic/Bearer 鉴权 + 路径防穿越）、commits/tree 浏览 API，9 项 e2e 全过（`pnpm --filter @teamai/server test:e2e:git`，含真实 clone/push）；客户端「项目仓库」页（列表/新建/克隆/复制地址/提交历史抽屉）；会话存档 API + Agent 页「保存会话」按钮。待补：仓库级成员权限（当前所有登录用户可读写全部仓库）、分支管理 UI。
- **Phase 3（已完成核心）**：自研轻量 IM 落地——单聊（自动去重）/群组、REST 历史 + WebSocket 实时广播（token 认证、在线连接管理）、未读数与已读标记、消息悬停「喂给 AI」跳转 Agent 工作台；AI 角色引擎：群内 @角色名 触发 → 带人设 prompt + 最近 30 条上下文调用网关 → 以角色身份回复并广播、用量计入触发者。15 项 e2e 全过（`pnpm --filter @teamai/server test:e2e:im`，含双端 WS 实时收发）。待补：文件/图片消息、消息分页加载 UI、typing 指示 UI、关键词/自动触发模式。
- **Phase 4**：在线环境（容器沙箱）、Web 端、审计与报表完善、macOS 打包。

## 8. 风险与注意事项

- **CLI 协议漂移**：headless 输出格式随版本变化，适配层需做版本探测与兜底；参考 ai-cli-hub 的"untested adapter"策略——先按公开文档实现，逐个实测。
- **Windows 编码**：控制台 GBK/UTF-8 乱码需在适配层做保守修复（ai-cli-hub 已积累经验）。
- **网关兼容性**：CLI 对 BASE_URL 的行为差异（如路径拼接、鉴权头）需逐个验证，必要时网关同时暴露 OpenAI 与 Anthropic 两套端点。
- **Git 大文件**：默认不引入 LFS，仓库定位是代码与文档；大附件走 `/files`。
- **安全**：虚拟 Key 泄露风险通过"随时吊销 + 配额上限 + 审计"控制；服务端必须部署在团队内网或加 TLS 反代。
