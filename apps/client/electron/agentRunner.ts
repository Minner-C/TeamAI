import type { ChildProcess } from "node:child_process";
import { AcpClient } from "./acpClient.js";
import { runClaudeHeadless, type ClaudePermissionRequest } from "./claudeAdapter.js";

export interface AgentRunEvent {
  taskId: string;
  kind: "message" | "thought" | "tool" | "permission" | "done" | "error";
  text?: string;
  permission?: ClaudePermissionRequest;
}

interface RunHandle {
  cli: string;
  acp?: AcpClient;
  claude?: ChildProcess;
  permissionResolvers: Map<string, (allow: boolean) => void>;
}

const handles = new Map<string, RunHandle>();
let acpSingleton: AcpClient | null = null;

function getAcp(): AcpClient {
  if (!acpSingleton) acpSingleton = new AcpClient();
  return acpSingleton;
}

export async function runAgentCli(
  taskId: string,
  cli: string,
  cwd: string,
  prompt: string,
  onEvent: (ev: AgentRunEvent) => void,
): Promise<void> {
  if (handles.has(taskId)) throw new Error("任务已在运行中");

  if (cli === "kimi") {
    const acp = getAcp();
    const handle: RunHandle = { cli, acp, permissionResolvers: new Map() };
    handles.set(taskId, handle);
    const listener = (chunk: { taskId: string; kind: string; text?: string }) => {
      if (chunk.taskId !== taskId) return;
      onEvent({ taskId, kind: chunk.kind as AgentRunEvent["kind"], text: chunk.text });
      if (chunk.kind === "done" || chunk.kind === "error") {
        acp.off("chunk", listener);
        handles.delete(taskId);
      }
    };
    acp.on("chunk", listener);
    try {
      await acp.startSession(taskId, cwd);
      void acp.prompt(taskId, prompt);
    } catch (err) {
      acp.off("chunk", listener);
      handles.delete(taskId);
      throw err;
    }
    return;
  }

  if (cli === "claude") {
    const handle: RunHandle = { cli, permissionResolvers: new Map() };
    const child = runClaudeHeadless(
      {
        prompt,
        cwd,
        interactive: true,
        onPermissionRequest: (req) =>
          new Promise<boolean>((resolve) => {
            handle.permissionResolvers.set(req.requestId, resolve);
            onEvent({ taskId, kind: "permission", permission: req });
          }),
      },
      (ev) => {
        if (ev.type === "assistant" && ev.text) {
          onEvent({ taskId, kind: "message", text: ev.text });
        } else if (ev.type === "exit") {
          onEvent({ taskId, kind: "done" });
          handles.delete(taskId);
        } else if (ev.type === "stderr" && ev.text) {
          onEvent({ taskId, kind: "error", text: ev.text.trim() });
        }
      },
    );
    handle.claude = child;
    handles.set(taskId, handle);
    return;
  }

  throw new Error(`暂不支持本地运行 ${cli}，请使用网关模式`);
}

export function respondAgentPermission(taskId: string, requestId: string, allow: boolean): void {
  const handle = handles.get(taskId);
  const resolve = handle?.permissionResolvers.get(requestId);
  if (resolve) {
    handle!.permissionResolvers.delete(requestId);
    resolve(allow);
  }
}

export async function stopAgentCli(taskId: string): Promise<void> {
  const handle = handles.get(taskId);
  if (!handle) return;
  handles.delete(taskId);
  if (handle.cli === "kimi" && handle.acp) {
    await handle.acp.stopSession(taskId);
  }
  handle.claude?.kill("SIGTERM");
}

export function disposeAgentRunners(): void {
  for (const handle of handles.values()) {
    handle.claude?.kill("SIGTERM");
  }
  handles.clear();
  acpSingleton?.dispose();
  acpSingleton = null;
}
