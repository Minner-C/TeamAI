import WebSocket from "ws";
import { WS_PATH } from "@teamai/shared";
import type { WsClientEvent, WsServerEvent } from "@teamai/shared";

export class ImClient {
  private ws: WebSocket | null = null;

  connect(baseUrl: string, token: string, onEvent: (event: WsServerEvent) => void): void {
    const url = baseUrl.replace(/^http/, "ws") + WS_PATH;
    this.ws = new WebSocket(url);
    this.ws.on("open", () => this.send({ type: "auth", token }));
    this.ws.on("message", (raw: WebSocket.RawData) => {
      try {
        onEvent(JSON.parse(raw.toString()) as WsServerEvent);
      } catch {
        // ignore malformed frames
      }
    });
  }

  send(event: WsClientEvent): void {
    this.ws?.send(JSON.stringify(event));
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
