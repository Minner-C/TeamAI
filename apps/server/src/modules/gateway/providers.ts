import type { ProviderType } from "@teamai/shared";

export interface UpstreamRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: boolean;
}

export interface UpstreamResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  estimated: boolean;
}

export interface ProviderAdapter {
  type: ProviderType;
  complete(baseUrl: string, apiKey: string, req: UpstreamRequest): Promise<UpstreamResult>;
}

const anthropicAdapter: ProviderAdapter = {
  type: "anthropic",
  async complete() {
    throw new Error("anthropic adapter not implemented yet");
  },
};

const openaiCompatibleAdapter: ProviderAdapter = {
  type: "openai-compatible",
  async complete() {
    throw new Error("openai-compatible adapter not implemented yet");
  },
};

const geminiAdapter: ProviderAdapter = {
  type: "gemini",
  async complete() {
    throw new Error("gemini adapter not implemented yet");
  },
};

export const providerAdapters: Record<ProviderType, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  "openai-compatible": openaiCompatibleAdapter,
  gemini: geminiAdapter,
};
