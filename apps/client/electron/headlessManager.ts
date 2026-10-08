import { execFile } from "node:child_process";
import type { CliKind, CliChannel } from "@teamai/shared";

export interface CliInfo {
  kind: CliKind;
  channel: CliChannel;
  command: string;
  installed: boolean;
  version: string | null;
}

const CLI_TABLE: Array<Omit<CliInfo, "installed" | "version"> & { packageName: string }> = [
  { kind: "kimi", channel: "acp", command: "kimi", packageName: "@moonshot-ai/kimi-code" },
  { kind: "claude", channel: "headless-stream-json", command: "claude", packageName: "@anthropic-ai/claude-code" },
  { kind: "codex", channel: "headless-stream-json", command: "codex", packageName: "@openai/codex" },
  { kind: "gemini", channel: "headless-stream-json", command: "gemini", packageName: "@google/gemini-cli" },
  { kind: "qwen", channel: "headless-stream-json", command: "qwen", packageName: "@qwen-code/qwen-code" },
];

function probe(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      ["--version"],
      { timeout: 8000, shell: process.platform === "win32" },
      (err, stdout, stderr) => {
        if (err) return resolve(null);
        resolve((stdout || stderr).trim().split("\n")[0] || "unknown");
      },
    );
    child.on("error", () => resolve(null));
  });
}

export async function detectClis(): Promise<CliInfo[]> {
  return Promise.all(
    CLI_TABLE.map(async (c) => {
      const version = await probe(c.command);
      return { kind: c.kind, channel: c.channel, command: c.command, installed: version !== null, version };
    }),
  );
}

export interface CliInstallResult {
  ok: boolean;
  output: string;
  installed: boolean;
  version: string | null;
}

export function cliInstallInfo(kind: string): { packageName: string; command: string } | null {
  const entry = CLI_TABLE.find((c) => c.kind === kind);
  return entry ? { packageName: entry.packageName, command: entry.command } : null;
}

export async function installCli(kind: string): Promise<CliInstallResult> {
  const entry = CLI_TABLE.find((c) => c.kind === kind);
  if (!entry) return { ok: false, output: `未知的 CLI：${kind}`, installed: false, version: null };
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const output = await new Promise<string>((resolve) => {
    execFile(
      npmCmd,
      ["install", "-g", entry.packageName],
      { timeout: 600_000, shell: process.platform === "win32", maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const text = `${stdout ?? ""}${stderr ?? ""}`.trim();
        if (err) resolve(`安装失败（${err.message}）\n${text}`.trim());
        else resolve(text || "安装完成");
      },
    );
  });
  const version = await probe(entry.command);
  const installed = version !== null;
  return {
    ok: installed,
    output: installed ? output : `${output}\n安装后仍未检测到 ${entry.command} 命令，可能需要重启应用或检查 PATH`,
    installed,
    version,
  };
}
