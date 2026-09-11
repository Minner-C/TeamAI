import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { WS_PATH } from "@teamai/shared";
import type { WsClientEvent, WsServerEvent } from "@teamai/shared";

function send(ws: WebSocket, event: WsServerEvent) {
  ws.send(JSON.stringify(event));
}

export async function imWs(app: FastifyInstance) {
  app.get(WS_PATH, { websocket: true }, (socket) => {
    socket.on("message", (raw: Buffer) => {
      let event: WsClientEvent;
      try {
        event = JSON.parse(raw.toString()) as WsClientEvent;
      } catch {
        send(socket, { type: "error", reason: "invalid json" });
        return;
      }

      switch (event.type) {
        case "auth":
          send(socket, { type: "auth:error", reason: "auth not implemented yet" });
          break;
        case "ping":
          send(socket, { type: "pong" });
          break;
        default:
          send(socket, { type: "error", reason: "not implemented yet" });
      }
    });
  });
}
