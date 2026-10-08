import WebSocket from "ws";
import { WS_PATH } from "@teamai/shared";
import type { WsClientEvent, WsServerEvent } from "@teamai/shared";

export class ImClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private timer: NodeJS.Timeout | null = null;
  private baseUrl = "";
  private token = "";
  private onEvent: ((event: WsServerEvent) => void) | null = null;

  connect(baseUrl: string, token: string, onEvent: (event: WsServerEvent) => void): void {
    this.baseUrl = baseUrl;
    this.token = token;
    this.onEvent = onEvent;
    this.closed = false;
    this.open();
  }

  private open(): void {
    if (this.closed) return;
    const url = this.baseUrl.replace(/^http/, "ws") + WS_PATH;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.on("open", () => {
      this.retry = 0;
      this.send({ type: "auth", token: this.token });
    });
    ws.on("message", (raw: WebSocket.RawData) => {
      try {
        this.onEvent?.(JSON.parse(raw.toString()) as WsServerEvent);
      } catch {
        // ignore malformed frames
      }
    });
    ws.on("error", () => ws.close());
    ws.on("close", () => {
      if (this.ws === ws) this.ws = null;
      if (this.closed) return;
      const delay = Math.min(1000 * 2 ** this.retry++, 15000);
      this.timer = setTimeout(() => this.open(), delay);
    });
  }

  send(event: WsClientEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  disconnect(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
    this.ws = null;
  }
}
