export interface ServerConnection {
  baseUrl: string;
  token: string | null;
}

let connection: ServerConnection = {
  baseUrl: process.env.TEAMAI_SERVER_URL ?? "http://localhost:8787",
  token: null,
};

export function getConnection(): ServerConnection {
  return connection;
}

export function setConnection(baseUrl: string, token: string | null): void {
  connection = { baseUrl, token };
}

export interface LoginResult {
  token: string;
  user: { id: string; name: string; email: string; role: string };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${connection.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `login failed: ${res.status}`);
  }
  const data = (await res.json()) as LoginResult;
  connection.token = data.token;
  return data;
}

export async function listModels(): Promise<
  Array<{ model: string; providerId: string; providerType: string }>
> {
  const res = await fetch(`${connection.baseUrl}/api/models`, {
    headers: { authorization: `Bearer ${connection.token ?? ""}` },
  });
  if (!res.ok) throw new Error(`list models failed: ${res.status}`);
  const data = (await res.json()) as {
    models: Array<{ model: string; providerId: string; providerType: string }>;
  };
  return data.models;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatStream(
  model: string,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  cliTag = "teamai-client",
): Promise<void> {
  const res = await fetch(`${connection.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${connection.token ?? ""}`,
      "x-teamai-cli": cliTag,
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`chat failed: ${res.status} ${text}`);
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
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      } catch {
        // partial chunk, ignore
      }
    }
  }
}

export interface UsageSummary {
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  byModel: Record<string, { tokensIn: number; tokensOut: number }>;
  byUser: Record<string, { tokensIn: number; tokensOut: number }>;
}

export async function usageSummary(): Promise<UsageSummary> {
  const res = await fetch(`${connection.baseUrl}/api/usage/summary`, {
    headers: { authorization: `Bearer ${connection.token ?? ""}` },
  });
  if (!res.ok) throw new Error(`usage summary failed: ${res.status}`);
  return (await res.json()) as UsageSummary;
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

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${connection.baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${connection.token ?? ""}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text}`);
  }
  return res;
}

export async function listRepos(): Promise<RepoView[]> {
  const res = await apiFetch("/api/repos");
  return ((await res.json()) as { repos: RepoView[] }).repos;
}

export async function createRepo(name: string, group: string): Promise<RepoView> {
  const res = await apiFetch("/api/repos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, group }),
  });
  return (await res.json()) as RepoView;
}

export async function deleteRepo(id: string): Promise<void> {
  await apiFetch(`/api/repos/${id}`, { method: "DELETE" });
}

export async function repoCommits(id: string) {
  const res = await apiFetch(`/api/repos/${id}/commits`);
  return ((await res.json()) as { commits: Array<{ hash: string; author: string; at: number; message: string }> }).commits;
}

export async function saveSession(input: {
  title?: string;
  cli?: string;
  taskId?: string;
  messages: unknown[];
}): Promise<string> {
  const res = await apiFetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return ((await res.json()) as { id: string }).id;
}

export function gitRemoteUrl(group: string, name: string, email: string): string {
  const u = new URL(connection.baseUrl);
  u.username = encodeURIComponent(email);
  u.password = encodeURIComponent(connection.token ?? "");
  u.pathname = `/git/${group}/${name}.git`;
  return u.toString();
}

export async function checkServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${connection.baseUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
