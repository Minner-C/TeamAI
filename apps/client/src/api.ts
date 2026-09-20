import type { ChatChunk } from "./teamai.js";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface RepoView {
  id: string;
  name: string;
  group: string;
  ownerId: string;
  visibility: string;
  memberCount: number;
  createdAt: number;
}

export interface ImMessage {
  id: string;
  channelId: string;
  senderUserId: string | null;
  senderRoleId: string | null;
  senderName: string;
  type: string;
  content: string;
  payload?: { fileId?: string; name?: string; size?: number; mime?: string };
  createdAt: number;
}

export interface ChannelView {
  id: string;
  type: "dm" | "group";
  name: string;
  ownerId: string;
  createdAt: number;
  unread: number;
  lastMessage: ImMessage | null;
}

export interface AgentChunk {
  taskId: string;
  kind: "message" | "thought" | "tool" | "permission" | "done" | "error";
  text?: string;
  permission?: { requestId: string; toolName: string; input: Record<string, unknown>; description?: string };
}

export interface SessionView {
  id: string;
  userId: string;
  taskId: string;
  cli: string;
  title: string;
  createdAt: number;
}

export interface UsageBucket {
  tokensIn: number;
  tokensOut: number;
  cost: number;
  requests: number;
}

export interface UsageDimRow {
  name: string;
  tokensIn: number;
  tokensOut: number;
}

export interface UsageStats {
  range: UsageBucket;
  today: UsageBucket;
  week: UsageBucket;
  byDay: Array<{ day: string; tokens: number }>;
  byModel: UsageDimRow[];
  byUser: Array<UsageDimRow & { userId: string }>;
  byCli: UsageDimRow[];
}

export interface AiRoleView {
  id: string;
  channel_id: string;
  name: string;
  model: string;
  persona_prompt: string;
  trigger_kind: "mention" | "keyword" | "auto";
  trigger_keywords: string;
  enabled: number;
}

export type ImEvent =
  | { type: "auth:ok"; userId: string }
  | { type: "message:new"; message: ImMessage }
  | { type: "message:ack"; channelId: string; messageId: string; createdAt: number }
  | { type: "typing"; channelId: string; userId: string }
  | { type: "error"; reason: string }
  | { type: "pong" };

export interface EnvView {
  id: string;
  name: string;
  repoId: string | null;
  repoName: string | null;
  userId: string;
  userName: string;
  runCmd: string;
  status: string;
  pid: number | null;
  createdAt: number;
}

export interface FileInfo {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface FileView extends FileInfo {
  createdAt: number;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
}

const isElectron = typeof window !== "undefined" && !!window.teamai;

let directToken = localStorage.getItem("teamai_token") ?? "";
let imSocket: WebSocket | null = null;
let directBaseUrl = isElectron ? (localStorage.getItem("teamai_server_url") ?? "") : "";

type ChunkHandler = (chunk: ChatChunk) => void;
const chunkHandlers = new Set<ChunkHandler>();

async function directFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${directBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${directToken}`,
      ...(init?.headers ?? {}),
    },
  });
}

export const api = {
  isElectron,

  getServerUrl(): string {
    return directBaseUrl;
  },

  async setServerUrl(url: string): Promise<void> {
    let u = url.trim().replace(/\/+$/, "");
    if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
    u = u.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, "$1127.0.0.1");
    localStorage.setItem("teamai_server_url", u);
    if (isElectron) {
      await window.teamai.setServerUrl(u);
      directBaseUrl = u;
    } else {
      directBaseUrl = "";
    }
  },

  async login(email: string, password: string): Promise<{ token: string; user: SessionUser }> {
    if (isElectron) {
      const data = await window.teamai.login(email, password);
      directToken = data.token;
      localStorage.setItem("teamai_token", data.token);
      localStorage.setItem("teamai_user", JSON.stringify(data.user));
      return data;
    }
    const res = await fetch(`${directBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(err?.error ?? `登录失败：${res.status}`);
    }
    const data = (await res.json()) as { token: string; user: SessionUser };
    directToken = data.token;
    localStorage.setItem("teamai_token", data.token);
    localStorage.setItem("teamai_user", JSON.stringify(data.user));
    return data;
  },

  restoreSession(): { token: string; user: SessionUser } | null {
    const token = localStorage.getItem("teamai_token");
    const userRaw = localStorage.getItem("teamai_user");
    if (!token || !userRaw) return null;
    try {
      directToken = token;
      return { token, user: JSON.parse(userRaw) as SessionUser };
    } catch {
      return null;
    }
  },

  clearSession(): void {
    directToken = "";
    localStorage.removeItem("teamai_token");
    localStorage.removeItem("teamai_user");
  },

  async listModels(): Promise<Array<{ model: string; providerId: string; providerType: string }>> {
    if (isElectron) return window.teamai.listModels();
    const res = await directFetch("/api/models");
    if (!res.ok) throw new Error(`获取模型列表失败：${res.status}`);
    return ((await res.json()) as { models: Array<{ model: string; providerId: string; providerType: string }> })
      .models;
  },

  async usageSummary() {
    if (isElectron) return window.teamai.usageSummary();
    const res = await directFetch("/api/usage/summary");
    if (!res.ok) throw new Error(`获取用量失败：${res.status}`);
    return res.json() as Promise<{
      totalTokensIn: number;
      totalTokensOut: number;
      totalCost: number;
      byModel: Record<string, { tokensIn: number; tokensOut: number }>;
      byUser: Record<string, { tokensIn: number; tokensOut: number }>;
    }>;
  },

  async usageStats(params?: { from?: number; to?: number; userId?: string }): Promise<UsageStats> {
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", String(params.from));
    if (params?.to) qs.set("to", String(params.to));
    if (params?.userId) qs.set("userId", params.userId);
    const res = await directFetch(`/api/usage/stats${qs.size ? `?${qs}` : ""}`);
    if (!res.ok) throw new Error(`获取用量统计失败：${res.status}`);
    return res.json() as Promise<UsageStats>;
  },

  async checkServerHealth(): Promise<boolean> {
    try {
      if (isElectron) return await window.teamai.serverHealth();
      const res = await fetch("/health");
      return res.ok;
    } catch {
      return false;
    }
  },

  async detectClis() {
    if (isElectron) return window.teamai.detectClis();
    return [] as Array<{ kind: string; channel: string; command: string; installed: boolean; version: string | null }>;
  },

  async listRepos() {
    if (isElectron) return window.teamai.listRepos();
    const res = await directFetch("/api/repos");
    if (!res.ok) throw new Error(`获取仓库列表失败：${res.status}`);
    return ((await res.json()) as { repos: RepoView[] }).repos;
  },

  async createRepo(name: string, group: string, visibility = "team") {
    if (isElectron) return window.teamai.createRepo(name, group);
    const res = await directFetch("/api/repos", {
      method: "POST",
      body: JSON.stringify({ name, group, visibility }),
    });
    if (!res.ok) throw new Error(`创建仓库失败：${await res.text()}`);
    return (await res.json()) as RepoView;
  },

  async deleteRepo(id: string) {
    if (isElectron) return window.teamai.deleteRepo(id);
    const res = await directFetch(`/api/repos/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`删除失败：${res.status}`);
  },

  async repoCommits(id: string, ref?: string) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    if (isElectron) return window.teamai.repoCommits(id);
    const res = await directFetch(`/api/repos/${id}/commits${q}`);
    if (!res.ok) throw new Error(`获取提交历史失败：${res.status}`);
    return ((await res.json()) as {
      commits: Array<{ hash: string; author: string; at: number; message: string }>;
    }).commits;
  },

  async repoBranches(id: string): Promise<string[]> {
    const res = await directFetch(`/api/repos/${id}/branches`);
    if (!res.ok) throw new Error(`获取分支失败：${res.status}`);
    return ((await res.json()) as { branches: string[] }).branches;
  },

  repoRemoteUrl(group: string, name: string, email: string): Promise<string> {
    if (isElectron) return window.teamai.repoRemoteUrl(group, name, email);
    const u = new URL(window.location.origin);
    u.username = encodeURIComponent(email);
    u.password = encodeURIComponent(directToken);
    u.pathname = `/git/${group}/${name}.git`;
    return Promise.resolve(u.toString());
  },

  async pickDir(): Promise<string | null> {
    if (isElectron) return window.teamai.pickDir();
    return null;
  },

  async gitClone(repoUrl: string, targetDir: string): Promise<void> {
    if (isElectron) return window.teamai.gitClone(repoUrl, targetDir);
    throw new Error("浏览器模式不支持 clone，请复制仓库地址在本地终端操作");
  },

  async saveSession(input: { title?: string; cli?: string; taskId?: string; messages: unknown[] }) {
    if (isElectron) return window.teamai.saveSession(input);
    const res = await directFetch("/api/sessions", { method: "POST", body: JSON.stringify(input) });
    if (!res.ok) throw new Error(`保存会话失败：${res.status}`);
    return ((await res.json()) as { id: string }).id;
  },

  async listUsers(): Promise<SessionUser[]> {
    const res = await directFetch("/api/users");
    if (!res.ok) throw new Error(`获取用户列表失败：${res.status}`);
    return ((await res.json()) as { users: SessionUser[] }).users;
  },

  async createUser(name: string, email: string, password: string) {
    const res = await directFetch("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) throw new Error(`创建用户失败：${await res.text()}`);
    return res.json();
  },

  async listChannels(): Promise<ChannelView[]> {
    const res = await directFetch("/api/channels");
    if (!res.ok) throw new Error(`获取会话列表失败：${res.status}`);
    return ((await res.json()) as { channels: ChannelView[] }).channels;
  },

  async createChannel(input: { type: "dm" | "group"; name?: string; memberIds: string[] }) {
    const res = await directFetch("/api/channels", { method: "POST", body: JSON.stringify(input) });
    if (!res.ok) throw new Error(`创建会话失败：${await res.text()}`);
    return res.json() as Promise<{ id: string }>;
  },

  async listMessages(channelId: string, before?: number): Promise<ImMessage[]> {
    const q = before ? `?before=${before}` : "";
    const res = await directFetch(`/api/channels/${channelId}/messages${q}`);
    if (!res.ok) throw new Error(`获取消息失败：${res.status}`);
    return ((await res.json()) as { messages: ImMessage[] }).messages;
  },

  async sendMessage(
    channelId: string,
    content: string,
    type = "text",
    payload?: Record<string, unknown>,
  ): Promise<ImMessage> {
    const res = await directFetch(`/api/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, type, payload }),
    });
    if (!res.ok) throw new Error(`发送失败：${await res.text()}`);
    return (await res.json()) as ImMessage;
  },

  async markRead(channelId: string): Promise<void> {
    await directFetch(`/api/channels/${channelId}/read`, { method: "POST" });
  },

  async listRoles(channelId: string): Promise<AiRoleView[]> {
    const res = await directFetch(`/api/channels/${channelId}/roles`);
    if (!res.ok) throw new Error(`获取 AI 角色失败：${res.status}`);
    return ((await res.json()) as { roles: AiRoleView[] }).roles;
  },

  async createRole(
    channelId: string,
    input: { name: string; model: string; personaPrompt?: string; trigger?: string; keywords?: string[] },
  ) {
    const res = await directFetch(`/api/channels/${channelId}/roles`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`创建角色失败：${await res.text()}`);
    return res.json();
  },

  async updateRole(
    roleId: string,
    patch: { name?: string; personaPrompt?: string; model?: string; trigger?: string; keywords?: string[]; enabled?: boolean },
  ): Promise<AiRoleView> {
    const res = await directFetch(`/api/roles/${roleId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`更新角色失败：${await res.text()}`);
    return res.json();
  },

  async deleteRole(roleId: string): Promise<void> {
    await directFetch(`/api/roles/${roleId}`, { method: "DELETE" });
  },

  async uploadFile(file: File): Promise<FileInfo> {
    const res = await fetch(`${directBaseUrl}/api/files`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${directToken}`,
        "content-type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
      },
      body: file,
    });
    if (!res.ok) throw new Error(`上传失败：${await res.text()}`);
    return (await res.json()) as FileInfo;
  },

  fileUrl(fileId: string): string {
    return `${directBaseUrl}/api/files/${fileId}?token=${encodeURIComponent(directToken)}`;
  },

  async listFiles(): Promise<{ files: FileView[]; admin: boolean }> {
    const res = await directFetch("/api/files");
    return res.json();
  },

  async deleteFile(fileId: string): Promise<void> {
    await directFetch(`/api/files/${fileId}`, { method: "DELETE" });
  },

  async listEnvs(): Promise<EnvView[]> {
    const res = await directFetch("/api/envs");
    if (!res.ok) throw new Error(`获取环境列表失败：${res.status}`);
    return ((await res.json()) as { envs: EnvView[] }).envs;
  },

  async createEnv(input: { name: string; repoId?: string; runCmd?: string }): Promise<EnvView> {
    const res = await directFetch("/api/envs", { method: "POST", body: JSON.stringify(input) });
    if (!res.ok) throw new Error(`创建环境失败：${await res.text()}`);
    return (await res.json()) as EnvView;
  },

  async envAction(id: string, action: "start" | "stop"): Promise<void> {
    const res = await directFetch(`/api/envs/${id}/${action}`, { method: "POST" });
    if (!res.ok) throw new Error(`${action === "start" ? "启动" : "停止"}失败：${await res.text()}`);
  },

  async envLogs(id: string, tail = 300): Promise<{ status: string; lines: string[] }> {
    const res = await directFetch(`/api/envs/${id}/logs?tail=${tail}`);
    if (!res.ok) throw new Error(`获取日志失败：${res.status}`);
    return (await res.json()) as { status: string; lines: string[] };
  },

  async envExec(id: string, cmd: string): Promise<{ code: number; output: string }> {
    const res = await directFetch(`/api/envs/${id}/exec`, {
      method: "POST",
      body: JSON.stringify({ cmd }),
    });
    if (!res.ok) throw new Error(`执行失败：${await res.text()}`);
    return (await res.json()) as { code: number; output: string };
  },

  async deleteEnv(id: string): Promise<void> {
    const res = await directFetch(`/api/envs/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`删除环境失败：${res.status}`);
  },

  connectIm(handler: (event: ImEvent) => void): () => void {
    if (isElectron) {
      void window.teamai.imConnect();
      return window.teamai.onImEvent((ev) => handler(ev as ImEvent));
    }
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    imSocket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: directToken }));
    ws.onmessage = (e) => {
      try {
        handler(JSON.parse(e.data as string) as ImEvent);
      } catch {
        // ignore malformed frames
      }
    };
    return () => {
      if (imSocket === ws) imSocket = null;
      ws.close();
    };
  },

  sendTyping(channelId: string): void {
    if (isElectron) {
      void window.teamai.imTyping(channelId);
      return;
    }
    if (imSocket && imSocket.readyState === WebSocket.OPEN) {
      imSocket.send(JSON.stringify({ type: "typing", channelId }));
    }
  },

  async agentRun(input: { taskId: string; cli: string; cwd: string; prompt: string }): Promise<void> {
    if (!isElectron) throw new Error("本地 CLI 模式仅在桌面客户端可用");
    const res = await window.teamai.agentRun(input);
    if (!res) throw new Error("启动失败");
  },

  async agentStop(taskId: string): Promise<void> {
    if (isElectron) await window.teamai.agentStop(taskId);
  },

  agentPermission(taskId: string, requestId: string, allow: boolean): void {
    if (isElectron) void window.teamai.agentPermission({ taskId, requestId, allow });
  },

  onAgentChunk(handler: (chunk: AgentChunk) => void): () => void {
    if (isElectron) return window.teamai.onAgentEvent((ev) => handler(ev as AgentChunk));
    return () => {};
  },

  async listSessions(): Promise<SessionView[]> {
    const res = await directFetch("/api/sessions");
    if (!res.ok) throw new Error(`获取会话存档失败：${res.status}`);
    return ((await res.json()) as { sessions: SessionView[] }).sessions;
  },

  async getSession(id: string): Promise<{ id: string; title: string; messages: Array<{ role: string; content: string }> }> {
    const res = await directFetch(`/api/sessions/${id}`);
    if (!res.ok) throw new Error(`读取会话失败：${res.status}`);
    return res.json();
  },

  async chatSend(
    requestId: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<void> {
    if (isElectron) return window.teamai.chatSend(requestId, model, messages);
    const emit = (chunk: ChatChunk) => chunkHandlers.forEach((h) => h(chunk));
    try {
      const res = await fetch(`${directBaseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${directToken}`,
          "x-teamai-cli": "teamai-web-preview",
        },
        body: JSON.stringify({ model, messages, stream: true }),
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${text}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const delta = (JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> })
              .choices?.[0]?.delta?.content;
            if (delta) emit({ requestId, delta });
          } catch {
            // partial chunk
          }
        }
      }
      emit({ requestId, done: true });
    } catch (err) {
      emit({ requestId, error: err instanceof Error ? err.message : String(err) });
    }
  },

  onChatChunk(handler: ChunkHandler): () => void {
    if (isElectron) return window.teamai.onChatChunk(handler);
    chunkHandlers.add(handler);
    return () => chunkHandlers.delete(handler);
  },
};
