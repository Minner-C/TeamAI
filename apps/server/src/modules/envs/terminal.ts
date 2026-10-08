import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { spawn, type ChildProcess } from "node:child_process";
import { verifyToken } from "../core/crypto.js";
import { getEnv } from "./store.js";
import { terminalCommand } from "./runner.js";
import type { UserRow } from "../../types.js";

type TermClientEvent =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

function send(socket: WebSocket, obj: Record<string, unknown>): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(obj));
}

export async function envTerminalWs(app: FastifyInstance) {
  app.get("/api/envs/:id/terminal", { websocket: true }, async (socket: WebSocket, req: FastifyRequest) => {
    const { id } = req.params as { id: string };
    const token = (req.query as { token?: string }).token ?? "";
    const payload = verifyToken(token, app.config.jwtSecret);
    if (!payload) {
      send(socket, { type: "error", message: "unauthorized" });
      socket.close();
      return;
    }
    const user = app.db.prepare("SELECT * FROM users WHERE id = ?").get(payload.uid) as UserRow | undefined;
    const env = getEnv(app.db, id);
    if (!user || !env || (env.user_id !== user.id && user.role !== "admin")) {
      send(socket, { type: "error", message: "not found" });
      socket.close();
      return;
    }

    const spec = await terminalCommand(env);
    const child: ChildProcess = spawn(spec.cmd, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, TERM: "xterm-256color", COLUMNS: "120", LINES: "30", TEAMAI_ENV_ID: env.id },
    });

    send(socket, {
      type: "ready",
      pty: spec.pty,
      message: spec.pty ? undefined : "当前服务端不支持 PTY，终端为降级模式（无回显与行编辑）",
    });

    child.stdout?.on("data", (d: Buffer) => send(socket, { type: "output", data: d.toString("utf8") }));
    child.stderr?.on("data", (d: Buffer) => send(socket, { type: "output", data: d.toString("utf8") }));
    child.on("error", (err) => {
      send(socket, { type: "error", message: `终端启动失败：${err.message}` });
      socket.close();
    });
    child.on("exit", (code) => {
      send(socket, { type: "exit", code: code ?? -1 });
      socket.close();
    });

    socket.on("message", (raw: Buffer) => {
      let event: TermClientEvent;
      try {
        event = JSON.parse(raw.toString()) as TermClientEvent;
      } catch {
        return;
      }
      if (event.type === "input" && typeof event.data === "string") {
        if (child.stdin && !child.stdin.destroyed) child.stdin.write(event.data);
      } else if (event.type === "resize" && spec.pty) {
        const cols = Math.max(20, Math.min(500, Math.floor(event.cols) || 120));
        const rows = Math.max(5, Math.min(200, Math.floor(event.rows) || 30));
        if (child.stdin && !child.stdin.destroyed) child.stdin.write(`stty cols ${cols} rows ${rows}\n`);
      }
    });

    socket.on("close", () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    });
  });
}
