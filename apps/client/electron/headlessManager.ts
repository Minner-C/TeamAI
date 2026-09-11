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

export async function detectClis(): Promise<CliInfo[]> {
  return CLI_TABLE.map((c) => ({ ...c, installed: false, version: null }));
}
