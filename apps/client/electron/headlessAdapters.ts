import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

export interface HeadlessEvent {
  raw: Record<string, unknown>;
  type: "assistant" | "thought" | "tool" | "stderr" | "error" | "exit" | "unparsed";
  text?: string;
}

export interface HeadlessOptions {
  prompt: string;
  cwd: string;
  env?: Record<string, string>;
  command?: string;
}

function spawnCli(command: string, args: string[], opts: HeadlessOptions): ChildProcessWithoutNullStreams {
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    shell: process.platform === "win32",
  });
  child.stdin.end();
  return child;
}

function watchSpawnError(child: ChildProcessWithoutNullStreams, onEvent: (ev: HeadlessEvent) => void): void {
  child.on("error", (err) => {
    onEvent({ raw: {}, type: "error", text: `启动失败：${err.message}` });
  });
}

function bufferStderr(child: ChildProcessWithoutNullStreams, limit = 800): () => string {
  let tail = "";
  child.stderr.on("data", (chunk: Buffer) => {
    tail = (tail + chunk.toString("utf8")).slice(-limit);
  });
  return () => tail.trim();
}

export function codexArgs(prompt: string): string[] {
  return ["exec", "--json", "--skip-git-repo-check", "-s", "workspace-write", prompt];
}

interface CodexItem {
  id?: string;
  type?: string;
  item_type?: string;
  text?: string;
  command?: string;
  status?: string;
  message?: string;
  changes?: Array<{ path?: string; kind?: string }>;
}

export function parseCodexLine(line: string): HeadlessEvent | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { raw: { line }, type: "unparsed", text: line };
  }
  const type = typeof raw.type === "string" ? raw.type : "";

  if (type === "error" || type === "turn.failed") {
    const msg =
      (raw.message as string | undefined) ??
      ((raw.error as { message?: string } | undefined)?.message || line.slice(0, 300));
    if (type === "error" && /^reconnecting/i.test(msg)) {
      return { raw, type: "stderr", text: msg };
    }
    return { raw, type: "error", text: msg };
  }

  if (type === "item.completed" || type === "item.started") {
    const item = (raw.item ?? {}) as CodexItem;
    const itemType = item.type ?? item.item_type ?? "";
    if (itemType === "error") {
      return type === "item.completed" && item.message
        ? { raw, type: "error", text: item.message }
        : null;
    }
    if (type === "item.started" && itemType !== "command_execution") return null;
    switch (itemType) {
      case "agent_message":
      case "assistant_message":
        return type === "item.completed" ? { raw, type: "assistant", text: item.text ?? "" } : null;
      case "reasoning":
        return type === "item.completed" && item.text ? { raw, type: "thought", text: item.text } : null;
      case "command_execution":
        return { raw, type: "tool", text: item.command ?? "shell" };
      case "file_change": {
        const paths = (item.changes ?? []).map((c) => c.path).filter(Boolean).join(", ");
        return { raw, type: "tool", text: `修改文件${paths ? `：${paths}` : ""}` };
      }
      case "mcp_tool_call":
        return { raw, type: "tool", text: "MCP 工具调用" };
      case "web_search":
        return { raw, type: "tool", text: "联网搜索" };
      default:
        return null;
    }
  }

  return null;
}

export function runCodexHeadless(
  opts: HeadlessOptions,
  onEvent: (ev: HeadlessEvent) => void,
): ChildProcess {
  const child = spawnCli(opts.command ?? "codex", codexArgs(opts.prompt), opts);
  watchSpawnError(child, onEvent);
  const stderrTail = bufferStderr(child);

  let gotReply = false;
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const ev = parseCodexLine(line);
    if (!ev) return;
    if (ev.type === "assistant" && ev.text) gotReply = true;
    onEvent(ev);
  });

  child.on("close", (code) => {
    if ((code ?? -1) !== 0 && !gotReply) {
      onEvent({ raw: {}, type: "error", text: stderrTail() || `codex 退出码 ${code ?? -1}` });
    }
    onEvent({ raw: {}, type: "exit", text: String(code ?? -1) });
  });
  return child;
}

export function geminiStyleArgs(cli: "gemini" | "qwen", prompt: string): string[] {
  if (cli === "qwen") return [prompt, "--output-format", "json", "--yolo"];
  return ["-p", prompt, "--output-format", "json", "--yolo"];
}

export interface GeminiStyleResult {
  response?: string;
  error?: string;
}

export function parseGeminiOutput(stdout: string): GeminiStyleResult {
  const trimmed = stdout.trim();
  if (!trimmed) return { error: "CLI 没有输出" };
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    const err = json.error;
    if (err) {
      const msg =
        typeof err === "string" ? err : ((err as { message?: string })?.message ?? JSON.stringify(err));
      return { error: msg };
    }
    if (typeof json.response === "string") return { response: json.response };
    return { response: trimmed };
  } catch {
    return { response: trimmed };
  }
}

export function parseQwenOutput(stdout: string): GeminiStyleResult {
  const trimmed = stdout.trim();
  if (!trimmed) return { error: "CLI 没有输出" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { response: trimmed };
  }
  const items = (Array.isArray(parsed) ? parsed : [parsed]) as Array<Record<string, unknown>>;
  const errOf = (obj: Record<string, unknown>): string | null => {
    const err = obj.error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const msg = (err as { message?: string }).message;
      return typeof msg === "string" ? msg : JSON.stringify(err);
    }
    return null;
  };
  const result = [...items].reverse().find((it) => it && typeof it === "object" && it.type === "result");
  if (result) {
    const err = errOf(result);
    if (err || result.is_error === true) return { error: err ?? "qwen 执行失败" };
    if (typeof result.result === "string" && result.result.trim()) return { response: result.result };
  }
  for (const obj of [...items].reverse()) {
    if (!obj || typeof obj !== "object") continue;
    const err = errOf(obj);
    if (err) return { error: err };
    if (typeof obj.response === "string") return { response: obj.response };
    if (typeof obj.result === "string" && obj.result.trim()) return { response: obj.result };
    if (obj.type === "assistant") {
      const content = (obj.message as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
      if (Array.isArray(content)) {
        const text = content.filter((c) => c?.type === "text").map((c) => c.text ?? "").join("");
        if (text.trim()) return { response: text };
      }
    }
  }
  return { response: trimmed };
}

function extractStderrJsonError(tail: string): string | null {
  const start = tail.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(tail.slice(start)) as { error?: unknown };
    const err = parsed?.error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const msg = (err as { message?: string }).message;
      if (typeof msg === "string") return msg;
    }
  } catch {
    return null;
  }
  return null;
}

export function runGeminiStyleHeadless(
  cli: "gemini" | "qwen",
  opts: HeadlessOptions,
  onEvent: (ev: HeadlessEvent) => void,
): ChildProcess {
  const child = spawnCli(opts.command ?? cli, geminiStyleArgs(cli, opts.prompt), opts);
  watchSpawnError(child, onEvent);
  const stderrTail = bufferStderr(child, 4000);

  let buf = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
  });

  child.on("close", (code) => {
    let replied = false;
    let handledError = false;
    if ((code ?? -1) === 0 || buf.trim()) {
      const result = cli === "qwen" ? parseQwenOutput(buf) : parseGeminiOutput(buf);
      if (result.error) {
        onEvent({ raw: {}, type: "error", text: result.error });
        handledError = true;
      } else if (result.response) {
        onEvent({ raw: {}, type: "assistant", text: result.response });
        replied = true;
      }
    }
    if ((code ?? -1) !== 0 && !replied && !handledError) {
      const tail = stderrTail();
      const msg = extractStderrJsonError(tail);
      onEvent({ raw: {}, type: "error", text: msg ?? (tail || `${cli} 退出码 ${code ?? -1}`) });
    }
    onEvent({ raw: {}, type: "exit", text: String(code ?? -1) });
  });
  return child;
}
