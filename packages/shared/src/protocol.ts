import type { Message } from "./types.js";

export type WsClientEvent =
  | { type: "auth"; token: string }
  | { type: "message:send"; channelId: string; msgType: Message["type"]; content: string; payload?: Record<string, unknown> }
  | { type: "message:read"; channelId: string; messageId: string }
  | { type: "typing"; channelId: string }
  | { type: "ping" };

export type WsServerEvent =
  | { type: "auth:ok"; userId: string }
  | { type: "auth:error"; reason: string }
  | { type: "message:new"; message: Message }
  | { type: "message:ack"; channelId: string; messageId: string; createdAt: number }
  | { type: "presence"; userId: string; online: boolean }
  | { type: "typing"; channelId: string; userId: string }
  | { type: "error"; reason: string }
  | { type: "pong" };

export const WS_PATH = "/ws";
