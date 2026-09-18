import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import { EventEmitter } from "node:events";
import type { CliKind } from "@teamai/shared";

export interface AcpSession {
  taskId: string;
  sessionId: string;
  cwd: string;
}

export interface AcpChunk {
  taskId: string;
  text?: string;
  kind: "message" | "thought" | "tool" | "done" | "error";
  raw?: Record<string, unknown>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

const ACP_PROTOCOL_VERSION = 1;

export class AcpClient extends EventEmitter {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private sessions = new Map<string, AcpSession>();
  private taskBySessionId = new Map<string, string>();
  private ready: Promise<void> | null = null;

  constructor(
    private command = "kimi",
    private args: string[] = ["acp"],
  ) {
    super();
  }

  private ensureProcess(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolveReady, rejectReady) => {
      this.child = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      this.child.on("error", (err) => {
        this.ready = null;
        rejectReady(new Error(`无法启动 ${this.command} ACP 进程：${err.message}`));
      });
      this.child.on("exit", (code) => {
        this.ready = null;
        this.child = null;
        const err = new Error(`ACP 进程已退出（code=${code ?? "-"}）`);
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
      });
      this.child.stderr?.on("data", (d: Buffer) => {
        this.emit("stderr", d.toString("utf8"));
      });

      const rl = readline.createInterface({ input: this.child.stdout! });
      rl.on("line", (line) => this.onLine(line));

      this.call("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        clientInfo: { name: "teamai-client", version: "0.1.0" },
      })
        .then(() => {
          this.notify("initialized", {});
          resolveReady();
        })
        .catch(rejectReady);
    });
    return this.ready;
  }

  private onLine(line: string) {
    if (!line.trim()) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof msg.id === "number" && ("result" in msg || "error" in msg)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      const errObj = msg.error as { message?: string } | undefined;
      if (errObj) p.reject(new Error(errObj.message ?? "ACP error"));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === "session/update") {
      const params = msg.params as {
        sessionId?: string;
        update?: { sessionUpdate?: string; content?: { type?: string; text?: string } };
      };
      const taskId = params.sessionId ? this.taskBySessionId.get(params.sessionId) : undefined;
      if (!taskId) return;
      const update = params.update ?? {};
      if (update.sessionUpdate === "agent_message_chunk" && update.content?.text) {
        this.emit("chunk", { taskId, text: update.content.text, kind: "message", raw: msg } satisfies AcpChunk);
      } else if (update.sessionUpdate === "agent_thought_chunk" && update.content?.text) {
        this.emit("chunk", { taskId, text: update.content.text, kind: "thought", raw: msg } satisfies AcpChunk);
      } else if (update.sessionUpdate?.startsWith("tool_call")) {
        this.emit("chunk", { taskId, kind: "tool", raw: msg } satisfies AcpChunk);
      }
    }
  }

  private send(payload: JsonRpcRequest | Record<string, unknown>) {
    if (!this.child?.stdin?.writable) throw new Error("ACP 进程不可用");
    this.child.stdin.write(JSON.stringify(payload) + "\n");
  }

  private call(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params?: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async startSession(taskId: string, cwd: string): Promise<AcpSession> {
    await this.ensureProcess();
    const result = (await this.call("session/new", { cwd, mcpServers: [] })) as { sessionId?: string };
    if (!result?.sessionId) throw new Error("ACP 未返回 sessionId");
    const session: AcpSession = { taskId, sessionId: result.sessionId, cwd };
    this.sessions.set(taskId, session);
    this.taskBySessionId.set(session.sessionId, taskId);
    return session;
  }

  async prompt(taskId: string, text: string): Promise<void> {
    const session = this.sessions.get(taskId);
    if (!session) throw new Error(`会话不存在：${taskId}`);
    try {
      await this.call("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text }],
      });
      this.emit("chunk", { taskId, kind: "done" } satisfies AcpChunk);
    } catch (err) {
      this.emit("chunk", {
        taskId,
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      } satisfies AcpChunk);
    }
  }

  async stopSession(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId);
    if (!session) return;
    try {
      await this.call("session/cancel", { sessionId: session.sessionId });
    } catch {
      // 进程可能已退出，忽略
    }
    this.taskBySessionId.delete(session.sessionId);
    this.sessions.delete(taskId);
  }

  dispose(): void {
    this.child?.kill();
    this.child = null;
    this.ready = null;
    this.sessions.clear();
    this.taskBySessionId.clear();
  }
}

export const acpCli: CliKind = "kimi";
