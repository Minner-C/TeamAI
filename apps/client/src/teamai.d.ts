export interface ChatChunk {
  requestId: string;
  delta?: string;
  done?: boolean;
  error?: string;
}

export interface TeamAiApi {
  detectClis(): Promise<
    Array<{ kind: string; channel: string; command: string; installed: boolean; version: string | null }>
  >;
  listModelRoutes(): Promise<Array<{ model: string; cli: string; providerType: string }>>;
  gitClone(repoUrl: string, targetDir: string): Promise<void>;
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
