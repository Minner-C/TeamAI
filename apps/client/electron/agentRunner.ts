import type { ChildProcess } from "node:child_process";
import { AcpClient } from "./acpClient.js";
import { runClaudeHeadless, type ClaudePermissionRequest } from "./claudeAdapter.js";
import { runCodexHeadless, runGeminiStyleHeadless, type HeadlessEvent } from "./headlessAdapters.js";
import { gatewayEnvForCli } from "./modelRegistry.js";
import { ensureAgentKey, getConnection } from "./serverClient.js";

export interface AgentRunEvent {
  taskId: string;
  kind: "message" | "thought" | "tool" | "permission" | "done" | "error";
  text?: string;
  permission?: ClaudePermissionRequest;
}

interface RunHandle {
  cli: string;
  acp?: AcpClient;
  child?: ChildProcess;
  permissionResolvers: Map<string, (allow: boolean) => void>;
}

const handles = new Map<string, RunHandle>();
let acpSingleton: AcpClient | null = null;

function getAcp(): AcpClient {
  if (!acpSingleton) acpSingleton = new AcpClient();
  return acpSingleton;
}

export interface AgentRunOptions {
  viaGateway?: boolean;
}

async function gatewayEnv(cli: string, viaGateway: boolean): Promise<Record<string, string> | undefined> {
  if (!viaGateway) return undefined;
  const conn = getConnection();
  if (!conn.baseUrl || !conn.token) return undefined;
  const key = await ensureAgentKey();
  if (!key) return undefined;
  return gatewayEnvForCli(cli, conn.baseUrl, key) ?? undefined;
}

export async function runAgentCli(
  taskId: string,
  cli: string,
  cwd: string,
  prompt: string,
  onEvent: (ev: AgentRunEvent) => void,
  opts?: AgentRunOptions,
): Promise<void> {
  if (handles.has(taskId)) throw new Error("任务已在运行中");

  const injectedEnv = await gatewayEnv(cli, opts?.viaGateway ?? true);
  if (injectedEnv) {
    onEvent({ taskId, kind: "thought", text: `本轮流量经服务端网关计费（${cli} → ${getConnection().baseUrl}）` });
  }

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
        env: injectedEnv,
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
    handle.child = child;
    handles.set(taskId, handle);
    return;
  }

  if (cli === "codex" || cli === "gemini" || cli === "qwen") {
    const handle: RunHandle = { cli, permissionResolvers: new Map() };
    const forward = (ev: HeadlessEvent) => {
      if (ev.type === "assistant" && ev.text) {
        onEvent({ taskId, kind: "message", text: ev.text });
      } else if (ev.type === "thought" && ev.text) {
        onEvent({ taskId, kind: "thought", text: ev.text });
      } else if (ev.type === "tool" && ev.text) {
        onEvent({ taskId, kind: "tool", text: ev.text });
      } else if (ev.type === "error" && ev.text) {
        onEvent({ taskId, kind: "error", text: ev.text.trim() });
      } else if (ev.type === "exit") {
        onEvent({ taskId, kind: "done" });
        handles.delete(taskId);
      }
    };
    const child =
      cli === "codex"
        ? runCodexHeadless({ prompt, cwd, env: injectedEnv }, forward)
        : runGeminiStyleHeadless(cli, { prompt, cwd, env: injectedEnv }, forward);
    handle.child = child;
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
  handle.child?.kill("SIGTERM");
}

export function disposeAgentRunners(): void {
  for (const handle of handles.values()) {
    handle.child?.kill("SIGTERM");
  }
  handles.clear();
  acpSingleton?.dispose();
  acpSingleton = null;
}
