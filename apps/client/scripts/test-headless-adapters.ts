import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  codexArgs,
  geminiArgs,
  parseCodexLine,
  parseGeminiOutput,
  runCodexHeadless,
  runGeminiStyleHeadless,
  type HeadlessEvent,
} from "../electron/headlessAdapters.ts";

let passed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
    console.log(`ok ${passed} - ${name}`);
  } else {
    console.error(`FAIL - ${name}${extra ? ` :: ${extra}` : ""}`);
    process.exit(1);
  }
}

const codexArgv = codexArgs("修复测试");
check("codex 参数：exec --json --full-auto --skip-git-repo-check + prompt",
  codexArgv.join(" ") === 'exec --json --full-auto --skip-git-repo-check 修复测试', codexArgv.join(" "));

const geminiArgv = geminiArgs("你好");
check("gemini 参数：-p + --output-format json + --yolo",
  geminiArgv.join(" ") === '-p 你好 --output-format json --yolo', geminiArgv.join(" "));

const ev1 = parseCodexLine('{"type":"item.completed","item":{"id":"i3","type":"agent_message","text":"回复文本"}}');
check("codex agent_message → assistant", ev1?.type === "assistant" && ev1.text === "回复文本");

const ev2 = parseCodexLine('{"type":"item.completed","item":{"id":"i2","type":"reasoning","text":"思考一下"}}');
check("codex reasoning → thought", ev2?.type === "thought" && ev2.text === "思考一下");

const ev3 = parseCodexLine('{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}');
check("codex command_execution → tool", ev3?.type === "tool" && ev3.text === "bash -lc ls");

const ev4 = parseCodexLine('{"type":"item.completed","item":{"id":"i4","type":"file_change","changes":[{"path":"src/a.ts"}]}}');
check("codex file_change → tool 带路径", ev4?.type === "tool" && (ev4.text ?? "").includes("src/a.ts"));

const ev5 = parseCodexLine('{"type":"thread.started","thread_id":"t1"}');
check("codex thread.started 忽略", ev5 === null);

const ev6 = parseCodexLine('{"type":"turn.completed","usage":{"input_tokens":1}}');
check("codex turn.completed 忽略", ev6 === null);

const ev7 = parseCodexLine('{"type":"turn.failed","message":"boom"}');
check("codex turn.failed → error", ev7?.type === "error" && ev7.text === "boom");

const ev8 = parseCodexLine('{"type":"item.completed","item":{"id":"i9","item_type":"assistant_message","text":"旧版字段"}}');
check("codex 旧版 item_type/assistant_message 兼容", ev8?.type === "assistant" && ev8.text === "旧版字段");

const ev9 = parseCodexLine("这不是 JSON");
check("codex 非 JSON 行 → unparsed", ev9?.type === "unparsed");

const g1 = parseGeminiOutput('{"response":"gemini 回复","stats":{}}');
check("gemini JSON → response", g1.response === "gemini 回复" && !g1.error);

const g2 = parseGeminiOutput('{"error":{"message":"quota exceeded"}}');
check("gemini error 对象 → error", g2.error === "quota exceeded");

const g3 = parseGeminiOutput("纯文本输出");
check("gemini 非 JSON 兜底为文本", g3.response === "纯文本输出");

const g4 = parseGeminiOutput("   ");
check("gemini 空输出 → error", !!g4.error);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-mock-cli-"));

function writeMock(name: string, body: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/usr/bin/env node\n${body}`);
  fs.chmodSync(p, 0o755);
  return p;
}

const mockCodex = writeMock("fake-codex.mjs", `
const lines = [
  { type: "thread.started", thread_id: "t1" },
  { type: "turn.started" },
  { type: "item.started", item: { id: "i1", type: "command_execution", command: "bash -lc ls", status: "in_progress" } },
  { type: "item.completed", item: { id: "i1", type: "command_execution", command: "bash -lc ls", status: "completed" } },
  { type: "item.completed", item: { id: "i2", type: "reasoning", text: "想一下" } },
  { type: "item.completed", item: { id: "i3", type: "agent_message", text: "codex 最终回复" } },
  { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } },
];
for (const l of lines) console.log(JSON.stringify(l));
console.error("progress info on stderr");
`);

const mockCodexFail = writeMock("fake-codex-fail.mjs", `
console.error("auth failed: invalid api key");
process.exit(1);
`);

const mockGemini = writeMock("fake-gemini.mjs", `
console.log(JSON.stringify({ response: "gemini 最终回复", stats: { models: {} } }));
console.error("some warning");
`);

const mockGeminiFail = writeMock("fake-gemini-fail.mjs", `
console.error("boom on stderr");
process.exit(1);
`);

function collect(run: (onEvent: (ev: HeadlessEvent) => void) => void): Promise<HeadlessEvent[]> {
  return new Promise((resolve) => {
    const events: HeadlessEvent[] = [];
    run((ev) => {
      events.push(ev);
      if (ev.type === "exit") setTimeout(() => resolve(events), 30);
    });
  });
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-mock-cwd-"));

const codexEvents = await collect((cb) => runCodexHeadless({ prompt: "干活", cwd, command: mockCodex }, cb));
check("mock codex：收到 assistant 回复",
  codexEvents.some((e) => e.type === "assistant" && e.text === "codex 最终回复"), JSON.stringify(codexEvents));
check("mock codex：收到 thought 与 tool",
  codexEvents.some((e) => e.type === "thought") && codexEvents.some((e) => e.type === "tool" && (e.text ?? "").includes("ls")));
check("mock codex：stderr 进度不产生 error 事件", !codexEvents.some((e) => e.type === "error"));
check("mock codex：exit 0 结束", codexEvents.some((e) => e.type === "exit" && e.text === "0"));

const codexFailEvents = await collect((cb) => runCodexHeadless({ prompt: "干活", cwd, command: mockCodexFail }, cb));
check("mock codex 失败：error 含 stderr 内容",
  codexFailEvents.some((e) => e.type === "error" && (e.text ?? "").includes("auth failed")), JSON.stringify(codexFailEvents));
check("mock codex 失败：exit 1", codexFailEvents.some((e) => e.type === "exit" && e.text === "1"));

const geminiEvents = await collect((cb) => runGeminiStyleHeadless("gemini", { prompt: "干活", cwd, command: mockGemini }, cb));
check("mock gemini：收到 assistant 回复",
  geminiEvents.some((e) => e.type === "assistant" && e.text === "gemini 最终回复"), JSON.stringify(geminiEvents));
check("mock gemini：warning 不产生 error 事件", !geminiEvents.some((e) => e.type === "error"));

const geminiFailEvents = await collect((cb) => runGeminiStyleHeadless("qwen", { prompt: "干活", cwd, command: mockGeminiFail }, cb));
check("mock qwen 失败：error 含 stderr 内容",
  geminiFailEvents.some((e) => e.type === "error" && (e.text ?? "").includes("boom")), JSON.stringify(geminiFailEvents));

const missingCmdEvents = await collect((cb) =>
  runCodexHeadless({ prompt: "干活", cwd, command: "definitely-not-exist-cli-xyz" }, cb));
check("命令不存在：error 启动失败", missingCmdEvents.some((e) => e.type === "error" && (e.text ?? "").includes("启动失败")));

console.log(`\nALL ${passed} ADAPTER TESTS PASSED`);
process.exit(0);

void fileURLToPath;
