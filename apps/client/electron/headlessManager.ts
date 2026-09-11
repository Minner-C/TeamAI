import { execFile } from "node:child_process";
import type { CliKind, CliChannel } from "@teamai/shared";

export interface CliInfo {
  kind: CliKind;
  channel: CliChannel;
  command: string;
  installed: boolean;
  version: string | null;
}

const CLI_TABLE: Array<Omit<CliInfo, "installed" | "version">> = [
  { kind: "kimi", channel: "acp", command: "kimi" },
  { kind: "claude", channel: "headless-stream-json", command: "claude" },
  { kind: "codex", channel: "headless-stream-json", command: "codex" },
  { kind: "gemini", channel: "headless-stream-json", command: "gemini" },
  { kind: "qwen", channel: "headless-stream-json", command: "qwen" },
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
      return { ...c, installed: version !== null, version };
    }),
  );
}
