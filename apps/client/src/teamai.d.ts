export interface ChatChunk {
  requestId: string;
  delta?: string;
  done?: boolean;
  error?: string;
}

export interface RepoView {
  id: string;
  name: string;
  group: string;
  ownerId: string;
  createdAt: number;
}

export interface TeamAiApi {
  detectClis(): Promise<
    Array<{ kind: string; channel: string; command: string; installed: boolean; version: string | null }>
  >;
  listModelRoutes(): Promise<Array<{ model: string; cli: string; providerType: string }>>;
  serverHealth(): Promise<boolean>;
  setServerUrl(url: string): Promise<boolean>;
  login(
    email: string,
    password: string,
  ): Promise<{ token: string; user: { id: string; name: string; email: string; role: string } }>;
  listModels(): Promise<Array<{ model: string; providerId: string; providerType: string }>>;
  usageSummary(): Promise<{
    totalTokensIn: number;
    totalTokensOut: number;
    totalCost: number;
    byModel: Record<string, { tokensIn: number; tokensOut: number }>;
    byUser: Record<string, { tokensIn: number; tokensOut: number }>;
  }>;
  listRepos(): Promise<RepoView[]>;
  createRepo(name: string, group: string): Promise<RepoView>;
  deleteRepo(id: string): Promise<void>;
  repoCommits(
    id: string,
  ): Promise<Array<{ hash: string; author: string; at: number; message: string }>>;
  repoRemoteUrl(group: string, name: string, email: string): Promise<string>;
  pickDir(): Promise<string | null>;
  gitClone(repoUrl: string, targetDir: string): Promise<void>;
  saveSession(input: {
    title?: string;
    cli?: string;
    taskId?: string;
    messages: unknown[];
  }): Promise<string>;
  imConnect(): Promise<boolean>;
  onImEvent(handler: (event: unknown) => void): () => void;
  chatSend(
    requestId: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<void>;
  onChatChunk(handler: (chunk: ChatChunk) => void): () => void;
}

declare global {
  interface Window {
    teamai: TeamAiApi;
  }
}

export {};
