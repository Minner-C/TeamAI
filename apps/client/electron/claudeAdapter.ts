import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";

export interface ClaudeHeadlessOptions {
  prompt: string;
  cwd: string;
  model?: string;
  env?: Record<string, string>;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  interactive?: boolean;
  autoApprove?: boolean;
  onPermissionRequest?: (req: ClaudePermissionRequest) => Promise<boolean> | boolean;
}

export interface ClaudePermissionRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  description?: string;
}

export interface ClaudeStreamEvent {
  raw: Record<string, unknown>;
  type: string;
  text?: string;
  permission?: ClaudePermissionRequest;
}

interface ControlRequestLine {
  type: "control_request";
  request_id: string;
  request: {
    subtype: string;
    tool_name?: string;
    input?: Record<string, unknown>;
    description?: string;
  };
}

function writeLine(child: ChildProcess, obj: Record<string, unknown>): void {
  if (child.stdin && !child.stdin.destroyed) {
    child.stdin.write(JSON.stringify(obj) + "\n");
  }
}

export function respondToPermission(
  child: ChildProcess,
  requestId: string,
  allow: boolean,
  message?: string,
): void {
  writeLine(child, {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: allow ? { behavior: "allow" } : { behavior: "deny", message: message ?? "user denied" },
    },
  });
}

export function sendUserMessage(child: ChildProcess, text: string): void {
  writeLine(child, {
    type: "user",
    message: { role: "user", content: text },
  });
}

export function runClaudeHeadless(
  opts: ClaudeHeadlessOptions,
  onEvent: (event: ClaudeStreamEvent) => void,
): ChildProcess {
  const args = ["--output-format", "stream-json", "--verbose"];
  if (opts.interactive) {
    args.push("--input-format", "stream-json");
  } else {
    args.push("-p", opts.prompt);
  }
  if (opts.model) args.push("--model", opts.model);
  if (opts.permissionMode) args.push("--permission-mode", opts.permissionMode);

  const child = spawn("claude", args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    shell: process.platform === "win32",
  });

  if (opts.interactive) {
    child.once("spawn", () => sendUserMessage(child, opts.prompt));
  }

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      onEvent({ raw: { line }, type: "unparsed", text: line });
      return;
    }

    if (raw.type === "control_request") {
      void handleControlRequest(child, raw as unknown as ControlRequestLine, opts, onEvent);
      return;
    }

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
  });

  child.stderr.on("data", (chunk: Buffer) => {
    onEvent({ raw: {}, type: "stderr", text: chunk.toString("utf8") });
  });

  child.on("close", (code) => {
    onEvent({ raw: {}, type: "exit", text: String(code ?? -1) });
  });

  return child;
}

async function handleControlRequest(
  child: ChildProcess,
  line: ControlRequestLine,
  opts: ClaudeHeadlessOptions,
  onEvent: (event: ClaudeStreamEvent) => void,
): Promise<void> {
  if (line.request.subtype !== "can_use_tool") {
    writeLine(child, {
      type: "control_response",
      response: { subtype: "error", request_id: line.request_id, error: "unsupported control request" },
    });
    return;
  }

  const permission: ClaudePermissionRequest = {
    requestId: line.request_id,
    toolName: line.request.tool_name ?? "unknown",
    input: line.request.input ?? {},
    description: line.request.description,
  };
  onEvent({ raw: line as unknown as Record<string, unknown>, type: "permission", permission });

  let allow = opts.autoApprove ?? false;
  if (opts.onPermissionRequest) {
    try {
      allow = await opts.onPermissionRequest(permission);
    } catch {
      allow = false;
    }
  }
  respondToPermission(child, permission.requestId, allow);
}
