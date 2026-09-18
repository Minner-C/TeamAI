import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

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
const WS = `ws://localhost:${SERVER_PORT}/ws`;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}`, extra ?? "");
  }
}

const upstream = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = JSON.parse(body || "{}");
    if (req.url === "/v1/chat/completions") {
      const userMsg = json.messages?.[json.messages.length - 1]?.content ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-im",
        model: json.model,
        choices: [{ index: 0, message: { role: "assistant", content: `【AI助手回复】收到：${userMsg.slice(0, 30)}` }, finish_reason: "stop" }],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      }));
      return;
    }
    res.writeHead(404).end();
  });
});
await new Promise((r) => upstream.listen(UPSTREAM_PORT, r));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-im-e2e-"));
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

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json()).token;
}

function wsConnect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const events = [];
    const waiters = [];
    ws.on("message", (raw) => {
      const e = JSON.parse(raw.toString());
      events.push(e);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(e)) {
          waiters[i].resolve(e);
          waiters.splice(i, 1);
        }
      }
    });
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("error", reject);
    const waitFor = (pred, ms = 5000) =>
      new Promise((res, rej) => {
        const existing = events.find(pred);
        if (existing) return res(existing);
        const w = { pred, resolve: res };
        waiters.push(w);
        setTimeout(() => rej(new Error("ws event timeout")), ms);
      });
    waitFor((e) => e.type === "auth:ok").then(() => resolve({ ws, events, waitFor }));
  });
}

try {
  const adminToken = await login("admin@teamai.local", "admin123");
  const authH = { "content-type": "application/json", authorization: `Bearer ${adminToken}` };

  const memberRes = await fetch(`${BASE}/api/admin/users`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ name: "小明", email: "ming@teamai.local", password: "pw123456" }),
  });
  const member = await memberRes.json();
  check("管理员创建成员账号", memberRes.status === 201, JSON.stringify(member));

  const memberToken = await login("ming@teamai.local", "pw123456");
  check("成员登录", !!memberToken);
  const memberH = { "content-type": "application/json", authorization: `Bearer ${memberToken}` };

  const users = await (await fetch(`${BASE}/api/users`, { headers: authH })).json();
  check("用户列表包含两人", users.users.length === 2);

  const chRes = await fetch(`${BASE}/api/channels`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ type: "group", name: "研发群", memberIds: [member.id] }),
  });
  const channel = await chRes.json();
  check("创建群组", chRes.status === 201 && channel.id);

  const adminWs = await wsConnect(adminToken);
  const memberWs = await wsConnect(memberToken);
  check("双方 WebSocket 认证成功", true);

  const sendRes = await fetch(`${BASE}/api/channels/${channel.id}/messages`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ content: "大家好，欢迎小明" }),
  });
  check("REST 发送消息", sendRes.status === 201);

  const got = await memberWs.waitFor(
    (e) => e.type === "message:new" && e.message.content.includes("欢迎小明"),
  );
  check("成员实时收到消息（WS 广播）", got.message.senderName === "Admin");

  memberWs.ws.send(JSON.stringify({
    type: "message:send",
    channelId: channel.id,
    msgType: "text",
    content: "大家好！",
  }));
  await adminWs.waitFor((e) => e.type === "message:new" && e.message.content === "大家好！");
  check("WS 发送消息对端实时收到", true);

  const beforeRead = await (await fetch(`${BASE}/api/channels`, { headers: memberH })).json();
  check("成员未读数 >= 1", beforeRead.channels[0].unread >= 1, JSON.stringify(beforeRead));

  await fetch(`${BASE}/api/channels/${channel.id}/read`, { method: "POST", headers: memberH });
  const afterRead = await (await fetch(`${BASE}/api/channels`, { headers: memberH })).json();
  check("标记已读后未读清零", afterRead.channels[0].unread === 0);

  await fetch(`${BASE}/api/admin/providers`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({
      name: "im-mock",
      type: "openai-compatible",
      baseUrl: `http://localhost:${UPSTREAM_PORT}`,
      apiKey: "k",
      models: ["im-model"],
    }),
  });

  const roleRes = await fetch(`${BASE}/api/channels/${channel.id}/roles`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ name: "小助手", model: "im-model", personaPrompt: "你是热心的团队助手。" }),
  });
  check("群组添加 AI 角色", roleRes.status === 201);

  await fetch(`${BASE}/api/channels/${channel.id}/messages`, {
    method: "POST",
    headers: memberH,
    body: JSON.stringify({ content: "@小助手 帮我总结下这个群是干嘛的" }),
  });
  const roleReply = await memberWs.waitFor(
    (e) => e.type === "message:new" && e.message.senderRoleId && e.message.content.includes("AI助手回复"),
    10000,
  );
  check("AI 角色被 @ 后自动回复并广播", roleReply.message.senderName === "小助手", JSON.stringify(roleReply));

  const history = await (
    await fetch(`${BASE}/api/channels/${channel.id}/messages?limit=50`, { headers: authH })
  ).json();
  check("历史消息包含全部 4 条", history.messages.length === 4, `got ${history.messages.length}`);

  const usage = await (await fetch(`${BASE}/api/usage/summary`, { headers: authH })).json();
  check("AI 角色调用计入用量", usage.byModel["im-model"]?.tokensIn === 50, JSON.stringify(usage.byModel));

  const badTrigger = await fetch(`${BASE}/api/channels/${channel.id}/roles`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ name: "坏角色", model: "im-model", trigger: "sometimes" }),
  });
  check("非法触发方式被拒", badTrigger.status === 400);

  const kwNoKw = await fetch(`${BASE}/api/channels/${channel.id}/roles`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ name: "空关键词", model: "im-model", trigger: "keyword", keywords: [] }),
  });
  check("关键词模式缺少关键词被拒", kwNoKw.status === 400);

  const kwRoleRes = await fetch(`${BASE}/api/channels/${channel.id}/roles`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ name: "报bug小助手", model: "im-model", trigger: "keyword", keywords: ["bug", "报错"] }),
  });
  const kwRole = await kwRoleRes.json();
  check("创建关键词触发角色", kwRoleRes.status === 201 && kwRole.trigger_keywords === "bug,报错", JSON.stringify(kwRole));

  await fetch(`${BASE}/api/channels/${channel.id}/messages`, {
    method: "POST",
    headers: memberH,
    body: JSON.stringify({ content: "今天天气不错" }),
  });
  await new Promise((r) => setTimeout(r, 1500));
  const noKwEvents = memberWs.events.filter((e) => e.message?.senderRoleId === kwRole.id);
  check("无关键词时关键词角色不触发", noKwEvents.length === 0, JSON.stringify(noKwEvents));

  await fetch(`${BASE}/api/channels/${channel.id}/messages`, {
    method: "POST",
    headers: memberH,
    body: JSON.stringify({ content: "线上出现一个 BUG，帮忙看看" }),
  });
  const kwReply = await memberWs.waitFor(
    (e) => e.type === "message:new" && e.message.senderRoleId === kwRole.id,
    10000,
  );
  check("命中关键词（大小写不敏感）自动回复", kwReply.message.senderName === "报bug小助手");

  const patchRes = await fetch(`${BASE}/api/roles/${kwRole.id}`, {
    method: "PATCH",
    headers: authH,
    body: JSON.stringify({ enabled: false }),
  });
  check("PATCH 停用角色", patchRes.status === 200 && (await patchRes.json()).enabled === 0);

  await fetch(`${BASE}/api/channels/${channel.id}/messages`, {
    method: "POST",
    headers: memberH,
    body: JSON.stringify({ content: "又一个 bug 来了" }),
  });
  await new Promise((r) => setTimeout(r, 1500));
  const disabledEvents = memberWs.events.filter(
    (e) => e.message?.senderRoleId === kwRole.id && e.message.content.includes("又一个"),
  );
  check("停用后角色不再触发", disabledEvents.length === 0);

  const autoRoleRes = await fetch(`${BASE}/api/channels/${channel.id}/roles`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ name: "碎碎念", model: "im-model", trigger: "auto", personaPrompt: "每条消息都要插话。" }),
  });
  const autoRole = await autoRoleRes.json();
  check("创建自动触发角色", autoRoleRes.status === 201 && autoRole.trigger_kind === "auto");

  await fetch(`${BASE}/api/channels/${channel.id}/messages`, {
    method: "POST",
    headers: memberH,
    body: JSON.stringify({ content: "随便说句话" }),
  });
  const autoReply = await memberWs.waitFor(
    (e) => e.type === "message:new" && e.message.senderRoleId === autoRole.id,
    10000,
  );
  check("自动角色对任意消息回复", autoReply.message.senderName === "碎碎念");

  const roleEvents = memberWs.events.filter((e) => e.message?.senderRoleId === autoRole.id);
  check("AI 角色的消息不会触发其它角色（防循环）", roleEvents.length === 1, `got ${roleEvents.length}`);

  memberWs.ws.send(JSON.stringify({ type: "typing", channelId: channel.id }));
  const typingEv = await adminWs.waitFor((e) => e.type === "typing" && e.channelId === channel.id);
  check("typing 事件广播给对方", typingEv.userId === member.id, JSON.stringify(typingEv));
  await new Promise((r) => setTimeout(r, 400));
  check(
    "发送者本人不收自己的 typing",
    !memberWs.events.some((e) => e.type === "typing" && e.userId === member.id),
  );

  const pageChRes = await fetch(`${BASE}/api/channels`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ type: "group", name: "分页测试群", memberIds: [member.id] }),
  });
  const pageCh = await pageChRes.json();
  for (let i = 1; i <= 60; i++) {
    await fetch(`${BASE}/api/channels/${pageCh.id}/messages`, {
      method: "POST",
      headers: authH,
      body: JSON.stringify({ content: `msg-${String(i).padStart(3, "0")}` }),
    });
  }
  const page1 = await (
    await fetch(`${BASE}/api/channels/${pageCh.id}/messages?limit=50`, { headers: authH })
  ).json();
  const oldest = page1.messages[0];
  const page2 = await (
    await fetch(`${BASE}/api/channels/${pageCh.id}/messages?before=${oldest.createdAt}&limit=50`, { headers: authH })
  ).json();
  const allIds = new Set([...page1.messages, ...page2.messages].map((m) => m.id));
  check("默认返回最近 50 条", page1.messages.length === 50, `got ${page1.messages.length}`);
  check(
    "before 分页取到更早消息且无重叠",
    page2.messages.length >= 5 &&
      !page2.messages.some((m) => m.id === oldest.id) &&
      allIds.size >= 55 &&
      page2.messages.every((m) => m.createdAt <= oldest.createdAt),
    `page2=${page2.messages.length} union=${allIds.size}`,
  );

  const outsider = await fetch(`${BASE}/api/channels/${channel.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}x` },
    body: JSON.stringify({ content: "hack" }),
  });
  check("非法 token 被拒", outsider.status === 401);

  adminWs.ws.close();
  memberWs.ws.close();

  console.log(failed === 0 ? "\nALL IM E2E TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
} finally {
  server.kill();
  upstream.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
