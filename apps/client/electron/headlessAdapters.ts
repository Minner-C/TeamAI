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
  return spawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    shell: process.platform === "win32",
  });
}

function watchSpawnError(child: ChildProcessWithoutNullStreams, onEvent: (ev: HeadlessEvent) => void): void {
  child.on("error", (err) => {
    onEvent({ raw: {}, type: "error", text: `启动失败：${err.message}` });
  });
}

function bufferStderr(child: ChildProcessWithoutNullStreams): () => string {
  let tail = "";
  child.stderr.on("data", (chunk: Buffer) => {
    tail = (tail + chunk.toString("utf8")).slice(-800);
  });
  return () => tail.trim();
}

export function codexArgs(prompt: string): string[] {
  return ["exec", "--json", "--full-auto", "--skip-git-repo-check", prompt];
}

interface CodexItem {
  id?: string;
  type?: string;
  item_type?: string;
  text?: string;
  command?: string;
  status?: string;
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
    return { raw, type: "error", text: msg };
  }

  if (type === "item.completed" || type === "item.started") {
    const item = (raw.item ?? {}) as CodexItem;
    const itemType = item.type ?? item.item_type ?? "";
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

export function geminiArgs(prompt: string): string[] {
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

export function runGeminiStyleHeadless(
  cli: "gemini" | "qwen",
  opts: HeadlessOptions,
  onEvent: (ev: HeadlessEvent) => void,
): ChildProcess {
  const child = spawnCli(opts.command ?? cli, geminiArgs(opts.prompt), opts);
  watchSpawnError(child, onEvent);
  const stderrTail = bufferStderr(child);

  let buf = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
  });

  child.on("close", (code) => {
    let replied = false;
    if ((code ?? -1) === 0 || buf.trim()) {
      const result = parseGeminiOutput(buf);
      if (result.error) onEvent({ raw: {}, type: "error", text: result.error });
      else if (result.response) {
        onEvent({ raw: {}, type: "assistant", text: result.response });
        replied = true;
      }
    }
    if ((code ?? -1) !== 0 && !replied) {
      onEvent({ raw: {}, type: "error", text: stderrTail() || `${cli} 退出码 ${code ?? -1}` });
    }
    onEvent({ raw: {}, type: "exit", text: String(code ?? -1) });
  });
  return child;
}
