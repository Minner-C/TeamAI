import type { ChatChunk } from "./teamai.js";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

const isElectron = typeof window !== "undefined" && !!window.teamai;

let directToken = localStorage.getItem("teamai_token") ?? "";
let directBaseUrl = "";

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
    if (isElectron) {
      await window.teamai.setServerUrl(url);
    } else {
      directBaseUrl = "";
    }
  },

  async login(email: string, password: string): Promise<{ token: string; user: SessionUser }> {
    if (isElectron) return window.teamai.login(email, password);
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
