import type { WebSocket } from "ws";
import type { Db } from "../../db.js";
import type { WsServerEvent } from "@teamai/shared";
import { channelMembers } from "./store.js";

const online = new Map<string, Set<WebSocket>>();

export function addConnection(userId: string, ws: WebSocket): void {
  if (!online.has(userId)) online.set(userId, new Set());
  online.get(userId)!.add(ws);
}

export function removeConnection(userId: string, ws: WebSocket): void {
  online.get(userId)?.delete(ws);
  if (online.get(userId)?.size === 0) online.delete(userId);
}

export function sendTo(ws: WebSocket, event: WsServerEvent): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
}

export function broadcastToChannel(db: Db, channelId: string, event: WsServerEvent, excludeUserId?: string): void {
  for (const uid of channelMembers(db, channelId)) {
    if (excludeUserId && uid === excludeUserId) continue;
    for (const ws of online.get(uid) ?? []) sendTo(ws, event);
  }
}

export function onlineUserIds(): string[] {
  return [...online.keys()];
}
