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

const hits = { "bad-key": 0, "good-key": 0, "good-key-2": 0 };
const upstream = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = JSON.parse(body || "{}");
    const auth = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    if (auth === "good-key" || auth === "good-key-2") {
      hits[auth]++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-pool",
          model: json.model,
          choices: [{ index: 0, message: { role: "assistant", content: `reply-by-${auth}` }, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
        }),
      );
      return;
    }
    hits["bad-key"]++;
    res.writeHead(401).end("invalid api key");
  });
});

await new Promise((r) => upstream.listen(UPSTREAM_PORT, r));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-e2e-pool-"));
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

async function createProvider(authH, name, model, apiKey) {
  const res = await fetch(`${BASE}/api/admin/providers`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ name, type: "openai-compatible", baseUrl: `http://localhost:${UPSTREAM_PORT}`, apiKey, models: [model] }),
  });
  return (await res.json()).id;
}

async function chat(vkH, model) {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: vkH,
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
  });
  return { status: res.status, json: await res.json() };
}

try {
  await waitReady();

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@teamai.local", password: "test-admin-pw" }),
  });
  const { token } = await login.json();
  const authH = { "content-type": "application/json", authorization: `Bearer ${token}` };

  const vkey = (
    await (await fetch(`${BASE}/api/keys`, { method: "POST", headers: authH, body: JSON.stringify({ name: "pool" }) })).json()
  ).key;
  const vkH = { "content-type": "application/json", authorization: `Bearer ${vkey}` };

  // --- 失败切换：第一个 Key 401，自动切到第二个 Key ---
  const p1 = await createProvider(authH, "pool-failover", "fo-gpt", "bad-key");
  const addKey = await fetch(`${BASE}/api/admin/providers/${p1}/keys`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ apiKey: "good-key", label: "好Key" }),
  });
  check("Key 池添加第二个 Key", addKey.status === 201);

  const keyList = await (await fetch(`${BASE}/api/admin/providers/${p1}/keys`, { headers: authH })).json();
  check("Key 池列表返回 2 个 Key 且脱敏", keyList.keys.length === 2 && keyList.keys.every((k) => !String(k.preview).includes("good-key") || k.preview.includes("...")), JSON.stringify(keyList));

  const before = { ...hits };
  const fo = await chat(vkH, "fo-gpt");
  check("坏 Key 失败后自动切换好 Key 成功", fo.status === 200 && fo.json.choices?.[0]?.message?.content === "reply-by-good-key", JSON.stringify(fo.json));
  check("坏 Key 被尝试过一次", hits["bad-key"] === before["bad-key"] + 1, JSON.stringify(hits));

  const keyList2 = await (await fetch(`${BASE}/api/admin/providers/${p1}/keys`, { headers: authH })).json();
  const badKeyRow = keyList2.keys.find((k) => k.label === "默认");
  check("失败计数已记录", badKeyRow && badKeyRow.failCount === 1, JSON.stringify(keyList2.keys));

  // --- 轮询：两个好 Key 轮流被选中 ---
  const p2 = await createProvider(authH, "pool-rr", "rr-gpt", "good-key");
  await fetch(`${BASE}/api/admin/providers/${p2}/keys`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ apiKey: "good-key-2", label: "第二把" }),
  });
  const rrBefore = { ...hits };
  const rr1 = await chat(vkH, "rr-gpt");
  const rr2 = await chat(vkH, "rr-gpt");
  const used = new Set([rr1.json.choices?.[0]?.message?.content, rr2.json.choices?.[0]?.message?.content]);
  check(
    "两次请求轮询命中不同 Key",
    rr1.status === 200 && rr2.status === 200 && used.has("reply-by-good-key") && used.has("reply-by-good-key-2"),
    JSON.stringify([...used]),
  );
  check("上游各被命中一次", hits["good-key"] === rrBefore["good-key"] + 1 && hits["good-key-2"] === rrBefore["good-key-2"] + 1);

  // --- 熔断：连续 3 次失败后冷却，不再打上游 ---
  const p3 = await createProvider(authH, "pool-cb", "cb-gpt", "bad-key");
  const cbBefore = hits["bad-key"];
  for (let i = 0; i < 3; i++) await chat(vkH, "cb-gpt");
  check("连续 3 次失败均打到上游", hits["bad-key"] === cbBefore + 3, `hits=${hits["bad-key"]}`);
  const cb4 = await chat(vkH, "cb-gpt");
  check("熔断冷却中直接返回 503 且不再打上游", cb4.status === 503 && hits["bad-key"] === cbBefore + 3, `status=${cb4.status} hits=${hits["bad-key"]}`);

  const cbKeys = await (await fetch(`${BASE}/api/admin/providers/${p3}/keys`, { headers: authH })).json();
  const reset = await fetch(`${BASE}/api/admin/providers/${p3}/keys/${cbKeys.keys[0].id}/reset`, { method: "POST", headers: authH });
  check("重置熔断状态", reset.status === 200);
  const cb5 = await chat(vkH, "cb-gpt");
  check("重置后恢复尝试上游", hits["bad-key"] === cbBefore + 4 && cb5.status === 401, `status=${cb5.status}`);

  // --- 成本估算：自定义定价 + 内置默认定价 ---
  await fetch(`${BASE}/api/admin/providers/${p2}`, {
    method: "PATCH",
    headers: authH,
    body: JSON.stringify({ pricing: { "rr-gpt": { in: 1, out: 2 } } }),
  });
  const costBefore = (await (await fetch(`${BASE}/api/usage/summary`, { headers: authH })).json()).totalCost ?? 0;
  await chat(vkH, "rr-gpt");
  const summary1 = await (await fetch(`${BASE}/api/usage/summary`, { headers: authH })).json();
  const customCost = summary1.totalCost - costBefore;
  check(
    "自定义定价成本落库（12in*1 + 7out*2 = 0.000026）",
    Math.abs(customCost - 0.000026) < 1e-9,
    `cost=${customCost}`,
  );

  await fetch(`${BASE}/api/admin/providers/${p2}`, {
    method: "PATCH",
    headers: authH,
    body: JSON.stringify({ models: ["rr-gpt", "gpt-4o"] }),
  });
  await chat(vkH, "gpt-4o");
  const summary2 = await (await fetch(`${BASE}/api/usage/summary`, { headers: authH })).json();
  const defaultCost = summary2.totalCost - summary1.totalCost;
  check(
    "内置默认定价（gpt-4o: 12in*2.5 + 7out*10 = 0.0001）",
    Math.abs(defaultCost - 0.0001) < 1e-9,
    `cost=${defaultCost}`,
  );

  const badPricing = await fetch(`${BASE}/api/admin/providers/${p2}`, {
    method: "PATCH",
    headers: authH,
    body: JSON.stringify({ pricing: { "x": { in: "not-a-number" } } }),
  });
  check("非法定价格式被拒绝 400", badPricing.status === 400);

  // --- Key 删除保护 ---
  const delLast = await fetch(`${BASE}/api/admin/providers/${p3}/keys/${cbKeys.keys[0].id}`, { method: "DELETE", headers: authH });
  check("删除唯一 Key 被拒绝", delLast.status === 400);
  const delBad = await fetch(`${BASE}/api/admin/providers/${p1}/keys/${badKeyRow.id}`, { method: "DELETE", headers: authH });
  check("删除非唯一 Key 成功", delBad.status === 200);

  console.log(failed === 0 ? "\nALL E2E TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
} finally {
  server.kill();
  upstream.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
