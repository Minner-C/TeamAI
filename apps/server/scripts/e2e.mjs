import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

const UPSTREAM_PORT = await freePort();
const SERVER_PORT = await freePort();
const BASE = `http://localhost:${SERVER_PORT}`;

let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}`, extra ?? "");
  }
}

const upstream = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = JSON.parse(body || "{}");
    if (req.url === "/v1/chat/completions" && req.headers.authorization === "Bearer real-openai-key") {
      if (json.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "chatcmpl-mock",
          model: json.model,
          choices: [{ index: 0, message: { role: "assistant", content: "mock reply" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
        }));
      }
      return;
    }
    if (req.url === "/v1/messages" && req.headers["x-api-key"] === "real-anthropic-key") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "msg-mock",
        model: json.model,
        content: [{ type: "text", text: "anthropic mock reply" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 20, output_tokens: 9 },
      }));
      return;
    }
    res.writeHead(401).end("bad upstream auth");
  });
});

await new Promise((r) => upstream.listen(UPSTREAM_PORT, r));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-e2e-"));
const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    TEAMAI_PORT: String(SERVER_PORT),
    TEAMAI_DATA_DIR: dataDir,
    TEAMAI_ADMIN_PASSWORD: "test-admin-pw",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server not ready");
}

try {
  await waitReady();

  const badLogin = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@teamai.local", password: "wrong" }),
  });
  check("错误密码登录被拒绝", badLogin.status === 401);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@teamai.local", password: "test-admin-pw" }),
  });
  const { token, user } = await login.json();
  check("管理员登录签发 token", login.status === 200 && !!token && user.role === "admin");

  const authH = { "content-type": "application/json", authorization: `Bearer ${token}` };

  const noAuth = await fetch(`${BASE}/api/usage/summary`);
  check("未认证访问用量接口被拒绝", noAuth.status === 401);

  const p1 = await fetch(`${BASE}/api/admin/providers`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({
      name: "mock-openai",
      type: "openai-compatible",
      baseUrl: `http://localhost:${UPSTREAM_PORT}`,
      apiKey: "real-openai-key",
      models: ["mock-gpt"],
    }),
  });
  check("创建 OpenAI 兼容 provider", p1.status === 200, await p1.clone().text());

  const p2 = await fetch(`${BASE}/api/admin/providers`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({
      name: "mock-anthropic",
      type: "anthropic",
      baseUrl: `http://localhost:${UPSTREAM_PORT}`,
      apiKey: "real-anthropic-key",
      models: ["mock-claude"],
    }),
  });
  check("创建 Anthropic provider", p2.status === 200);

  const models = await (await fetch(`${BASE}/api/models`, { headers: authH })).json();
  check("模型列表聚合两个 provider", models.models.length === 2);

  const keyRes = await fetch(`${BASE}/api/keys`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ name: "e2e" }),
  });
  const vkey = (await keyRes.json()).key;
  check("签发虚拟 Key", keyRes.status === 201 && vkey.startsWith("tk-"));

  const vkH = { "content-type": "application/json", authorization: `Bearer ${vkey}` };

  const noKey = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "mock-gpt", messages: [{ role: "user", content: "hi" }] }),
  });
  check("无虚拟 Key 调用网关被拒绝", noKey.status === 401);

  const chat = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: vkH,
    body: JSON.stringify({ model: "mock-gpt", messages: [{ role: "user", content: "hi" }] }),
  });
  const chatJson = await chat.json();
  check("OpenAI 非流式转发成功", chat.status === 200 && chatJson.choices?.[0]?.message?.content === "mock reply");

  const streamRes = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: vkH,
    body: JSON.stringify({ model: "mock-gpt", messages: [{ role: "user", content: "hi" }], stream: true }),
  });
  const streamText = await streamRes.text();
  check(
    "OpenAI 流式 SSE 透传",
    streamRes.status === 200 && streamText.includes("Hello") && streamText.includes("[DONE]"),
  );

  const cross = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: vkH,
    body: JSON.stringify({ model: "mock-gpt", messages: [{ role: "user", content: "hi" }], max_tokens: 100 }),
  });
  const crossJson = await cross.json();
  check(
    "跨协议：Anthropic 风格请求 → OpenAI provider",
    cross.status === 200 && crossJson.content?.[0]?.text === "mock reply" && crossJson.usage?.input_tokens === 12,
    JSON.stringify(crossJson),
  );

  const anth = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: vkH,
    body: JSON.stringify({ model: "mock-claude", messages: [{ role: "user", content: "hi" }], max_tokens: 100 }),
  });
  const anthJson = await anth.json();
  check("Anthropic 原生转发成功", anth.status === 200 && anthJson.content?.[0]?.text === "anthropic mock reply");

  const summary = await (await fetch(`${BASE}/api/usage/summary`, { headers: authH })).json();
  check(
    "用量聚合：4 次调用全部落库",
    summary.byModel["mock-gpt"]?.tokensIn === 10 + 12 + 12 && summary.byModel["mock-claude"]?.tokensIn === 20,
    JSON.stringify(summary),
  );

  const quotaKey = (
    await (
      await fetch(`${BASE}/api/keys`, {
        method: "POST",
        headers: authH,
        body: JSON.stringify({ name: "quota", quotaTokens: 1 }),
      })
    ).json()
  ).key;
  const quotaRes = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${quotaKey}` },
    body: JSON.stringify({ model: "mock-gpt", messages: [{ role: "user", content: "hi" }] }),
  });
  check("超额配额的虚拟 Key 被限流 429", quotaRes.status === 429);

  const keys = await (await fetch(`${BASE}/api/keys`, { headers: authH })).json();
  const del = await fetch(`${BASE}/api/keys/${keys.keys[0].id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  check("吊销虚拟 Key", del.status === 200);

  console.log(failed === 0 ? "\nALL E2E TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
} finally {
  server.kill();
  upstream.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
