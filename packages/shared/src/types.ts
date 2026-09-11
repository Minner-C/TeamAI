export type UserRole = "admin" | "member";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: number;
}

export type ProviderType =
  | "anthropic"
  | "openai-compatible"
  | "gemini";

export interface Provider {
  id: string;
  type: ProviderType;
  baseUrl: string;
  enabled: boolean;
}

export interface VirtualKey {
  id: string;
  key: string;
  userId: string;
  quotaTokens: number | null;
  revokedAt: number | null;
  createdAt: number;
}

export interface UsageRecord {
  id: string;
  userId: string;
  model: string;
  providerId: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  estimated: boolean;
  cli: string | null;
  taskId: string | null;
  ts: number;
}

export interface UsageSummary {
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  byModel: Record<string, { tokensIn: number; tokensOut: number }>;
  byUser: Record<string, { tokensIn: number; tokensOut: number }>;
}

export interface Repo {
  id: string;
  name: string;
  group: string;
  ownerId: string;
  createdAt: number;
}

export type ChannelType = "dm" | "group";

export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  ownerId: string;
  createdAt: number;
}

export type MessageType = "text" | "markdown" | "code" | "file" | "image" | "ai_request";

export interface Message {
  id: string;
  channelId: string;
  senderUserId: string | null;
  senderRoleId: string | null;
  type: MessageType;
  content: string;
  payload?: Record<string, unknown>;
  createdAt: number;
}

export interface AiRole {
  id: string;
  channelId: string;
  name: string;
  personaPrompt: string;
  model: string;
  trigger: "mention" | "keyword" | "auto";
  enabled: boolean;
}

export type CliKind = "kimi" | "claude" | "codex" | "gemini" | "qwen";

export type CliChannel = "acp" | "headless-stream-json" | "headless-text";

export interface ModelRoute {
  model: string;
  cli: CliKind;
  providerType: ProviderType;
}

export interface SessionArchiveMeta {
  id: string;
  userId: string;
  taskId: string;
  cli: CliKind;
  title: string;
  createdAt: number;
}
