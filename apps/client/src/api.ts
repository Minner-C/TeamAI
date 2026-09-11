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

export interface AiRoleView {
  id: string;
  channel_id: string;
  name: string;
  model: string;
  persona_prompt: string;
  enabled: number;
}

export type ImEvent =
  | { type: "auth:ok"; userId: string }
  | { type: "message:new"; message: ImMessage }
  | { type: "message:ack"; channelId: string; messageId: string; createdAt: number }
  | { type: "typing"; channelId: string; userId: string }
  | { type: "error"; reason: string }
  | { type: "pong" };

const isElectron = typeof window !== "undefined" && !!window.teamai;

let directToken = localStorage.getItem("teamai_token") ?? "";
let directBaseUrl = isElectron
  ? (localStorage.getItem("teamai_server_url") ?? "http://localhost:8787")
  : "";

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

  async setServerUrl(url: string): Promise<void> {
    localStorage.setItem("teamai_server_url", url);
    if (isElectron) {
      await window.teamai.setServerUrl(url);
      directBaseUrl = url;
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

  async createRepo(name: string, group: string) {
    if (isElectron) return window.teamai.createRepo(name, group);
    const res = await directFetch("/api/repos", {
      method: "POST",
      body: JSON.stringify({ name, group }),
    });
    if (!res.ok) throw new Error(`创建仓库失败：${await res.text()}`);
    return (await res.json()) as RepoView;
  },

  async deleteRepo(id: string) {
    if (isElectron) return window.teamai.deleteRepo(id);
    const res = await directFetch(`/api/repos/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`删除失败：${res.status}`);
  },

  async repoCommits(id: string) {
    if (isElectron) return window.teamai.repoCommits(id);
    const res = await directFetch(`/api/repos/${id}/commits`);
    if (!res.ok) throw new Error(`获取提交历史失败：${res.status}`);
    return ((await res.json()) as {
      commits: Array<{ hash: string; author: string; at: number; message: string }>;
    }).commits;
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

  async sendMessage(channelId: string, content: string, type = "text"): Promise<ImMessage> {
    const res = await directFetch(`/api/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, type }),
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

  async createRole(channelId: string, input: { name: string; model: string; personaPrompt?: string }) {
    const res = await directFetch(`/api/channels/${channelId}/roles`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`创建角色失败：${await res.text()}`);
    return res.json();
  },

  async deleteRole(roleId: string): Promise<void> {
    await directFetch(`/api/roles/${roleId}`, { method: "DELETE" });
  },

  connectIm(handler: (event: ImEvent) => void): () => void {
    if (isElectron) {
      void window.teamai.imConnect();
      return window.teamai.onImEvent((ev) => handler(ev as ImEvent));
    }
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: directToken }));
    ws.onmessage = (e) => {
      try {
        handler(JSON.parse(e.data as string) as ImEvent);
      } catch {
        // ignore malformed frames
      }
    };
    return () => ws.close();
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
