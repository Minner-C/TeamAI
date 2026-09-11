import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";

export interface ClaudeHeadlessOptions {
  prompt: string;
  cwd: string;
  model?: string;
  env?: Record<string, string>;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
}

export interface ClaudeStreamEvent {
  raw: Record<string, unknown>;
  type: string;
  text?: string;
}

export function runClaudeHeadless(
  opts: ClaudeHeadlessOptions,
  onEvent: (event: ClaudeStreamEvent) => void,
): ChildProcess {
  const args = [
    "-p",
    opts.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.permissionMode) args.push("--permission-mode", opts.permissionMode);

  const child = spawn("claude", args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    shell: process.platform === "win32",
  });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const type = typeof raw.type === "string" ? raw.type : "unknown";
      let text: string | undefined;
      if (type === "assistant") {
        const message = raw.message as { content?: Array<{ type: string; text?: string }> };
        text = message?.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("");
      }
      onEvent({ raw, type, text });
    } catch {
      onEvent({ raw: { line }, type: "unparsed", text: line });
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    onEvent({ raw: {}, type: "stderr", text: chunk.toString("utf8") });
  });

  child.on("close", (code) => {
    onEvent({ raw: {}, type: "exit", text: String(code ?? -1) });
  });

  return child;
}
