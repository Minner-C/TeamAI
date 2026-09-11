import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const UPSTREAM_PORT = 8898;
const SERVER_PORT = 8899;
const BASE = `http://localhost:${SERVER_PORT}`;

const upstream = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = JSON.parse(body || "{}");
    if (req.url === "/v1/chat/completions") {
      const reply = "你好！我是通过 TeamAI 网关转发过来的大模型回复。这条消息经过：客户端 → 服务端网关 → 上游模型 API，并且 token 用量已经自动记录。";
      if (json.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        let i = 0;
        const timer = setInterval(() => {
          if (i >= reply.length) {
            clearInterval(timer);
            res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 36, completion_tokens: reply.length / 2, total_tokens: 0 } })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply[i++] } }] })}\n\n`);
        }, 20);
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "chatcmpl-demo",
          model: json.model,
          choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
          usage: { prompt_tokens: 36, completion_tokens: 50, total_tokens: 86 },
        }));
      }
      return;
    }
    res.writeHead(404).end();
  });
});

await new Promise((r) => upstream.listen(UPSTREAM_PORT, r));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-demo-"));
const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, TEAMAI_PORT: String(SERVER_PORT), TEAMAI_DATA_DIR: dataDir },
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));

for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${BASE}/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

const login = await (await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@teamai.local", password: "admin123" }),
})).json();
console.log("① 登录成功，拿到 token：", login.token.slice(0, 24) + "…");

const authH = { "content-type": "application/json", authorization: `Bearer ${login.token}` };

await fetch(`${BASE}/api/admin/providers`, {
  method: "POST",
  headers: authH,
  body: JSON.stringify({
    name: "demo-upstream",
    type: "openai-compatible",
    baseUrl: `http://localhost:${UPSTREAM_PORT}`,
    apiKey: "real-key-hidden-on-server",
    models: ["demo-model"],
  }),
});
console.log("② 已配置上游 provider（真实 API Key 只存服务端，加密落库）");

const { key } = await (await fetch(`${BASE}/api/keys`, {
  method: "POST",
  headers: authH,
  body: JSON.stringify({ name: "demo" }),
})).json();
console.log("③ 签发虚拟 Key 给客户端使用：", key.slice(0, 12) + "…");

console.log("④ 客户端发起流式对话（模型：demo-model）\n");
console.log("AI 回复（流式逐字到达）：");
const res = await fetch(`${BASE}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: "demo-model",
    messages: [{ role: "user", content: "你好，介绍一下你自己" }],
    stream: true,
  }),
});
const reader = res.body.getReader();
let buf = "";
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += new TextDecoder().decode(value, { stream: true });
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") continue;
    try {
      const delta = JSON.parse(data).choices?.[0]?.delta?.content;
      if (delta) process.stdout.write(delta);
    } catch {}
  }
}

const summary = await (await fetch(`${BASE}/api/usage/summary`, { headers: authH })).json();
console.log("\n\n⑤ 服务端用量统计已自动记录：");
console.log(JSON.stringify(summary, null, 2));

server.kill();
upstream.close();
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(0);
