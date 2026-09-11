import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { WS_PATH } from "@teamai/shared";
import type { WsClientEvent, WsServerEvent } from "@teamai/shared";
import { verifyToken } from "../core/crypto.js";
import { addConnection, removeConnection, sendTo, broadcastToChannel } from "./hub.js";
import { insertMessage, isMember, toMessageView } from "./store.js";
import { triggerRolesForMessage } from "../airole/engine.js";

export async function imWs(app: FastifyInstance) {
  app.get(WS_PATH, { websocket: true }, (socket: WebSocket) => {
    let userId: string | null = null;

    socket.on("message", (raw: Buffer) => {
      let event: WsClientEvent;
      try {
        event = JSON.parse(raw.toString()) as WsClientEvent;
      } catch {
        sendTo(socket, { type: "error", reason: "invalid json" });
        return;
      }

      switch (event.type) {
        case "auth": {
          const payload = verifyToken(event.token, app.config.jwtSecret);
          if (!payload) {
            sendTo(socket, { type: "auth:error", reason: "invalid token" });
            return;
          }
          userId = payload.uid;
          addConnection(userId, socket);
          sendTo(socket, { type: "auth:ok", userId });
          break;
        }
        case "ping":
          sendTo(socket, { type: "pong" });
          break;
        case "message:send": {
          if (!userId) {
            sendTo(socket, { type: "error", reason: "not authenticated" });
            return;
          }
          if (!isMember(app.db, event.channelId, userId)) {
            sendTo(socket, { type: "error", reason: "not a member" });
            return;
          }
          const row = insertMessage(app.db, {
            channelId: event.channelId,
            senderUserId: userId,
            type: event.msgType,
            content: event.content,
            payload: event.payload,
          });
          sendTo(socket, { type: "message:ack", channelId: row.channel_id, messageId: row.id, createdAt: row.created_at });
          broadcastToChannel(app.db, row.channel_id, {
            type: "message:new",
            message: toMessageView(app.db, row),
          });
          setImmediate(() => void triggerRolesForMessage(app, row.id));
          break;
        }
        case "typing": {
          if (!userId) return;
          broadcastToChannel(app.db, event.channelId, {
            type: "typing",
            channelId: event.channelId,
            userId,
          });
          break;
        }
        default:
          sendTo(socket, { type: "error", reason: "unknown event" });
      }
    });

    socket.on("close", () => {
      if (userId) removeConnection(userId, socket);
    });
  });
}
