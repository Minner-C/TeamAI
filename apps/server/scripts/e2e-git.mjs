import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = await new Promise((resolve) => {
  const s = http.createServer();
  s.listen(0, () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const HOOK_PORT = await new Promise((resolve) => {
  const s = http.createServer();
  s.listen(0, () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const BASE = `http://localhost:${PORT}`;

const hookEvents = [];
const hookReceiver = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    hookEvents.push({ headers: req.headers, body: body ? JSON.parse(body) : null, raw: body });
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"received":true}');
  });
});
await new Promise((r) => hookReceiver.listen(HOOK_PORT, r));

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}`, extra ?? "");
  }
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-git-e2e-"));
const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, TEAMAI_PORT: String(PORT), TEAMAI_DATA_DIR: dataDir },
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));

for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${BASE}/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

try {
  const login = await (
    await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@teamai.local", password: "admin123" }),
    })
  ).json();
  const token = login.token;
  const authH = { "content-type": "application/json", authorization: `Bearer ${token}` };
  check("登录", !!token);

  const create = await fetch(`${BASE}/api/repos`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ name: "demo", group: "team" }),
  });
  check("创建仓库 team/demo", create.status === 201, await create.clone().text());
  const repoId = (await create.json()).id;

  const badHook = await fetch(`${BASE}/api/repos/${repoId}/webhooks`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ url: "not-a-url" }),
  });
  check("非法 webhook URL 被拒绝", badHook.status === 400);

  const hookRes = await fetch(`${BASE}/api/repos/${repoId}/webhooks`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ url: `http://localhost:${HOOK_PORT}/ci`, secret: "whsec" }),
  });
  check("添加仓库 webhook", hookRes.status === 201, await hookRes.clone().text());
  const hookId = (await hookRes.json()).id;

  const hookList = await (await fetch(`${BASE}/api/repos/${repoId}/webhooks`, { headers: authH })).json();
  check("webhook 列表 1 条且不泄露 secret", hookList.webhooks.length === 1 && hookList.webhooks[0].hasSecret === true && !("secret" in hookList.webhooks[0]));

  const pingRes = await (
    await fetch(`${BASE}/api/repos/${repoId}/webhooks/${hookId}/test`, { method: "POST", headers: authH })
  ).json();
  check("webhook 测试 ping 投递成功", pingRes.ok === true && pingRes.status === 200, JSON.stringify(pingRes));
  await new Promise((r) => setTimeout(r, 300));
  const ping = hookEvents.find((e) => e.body?.event === "ping");
  check("接收端拿到 ping 事件", !!ping && ping.body.repo.name === "demo");

  const dup = await fetch(`${BASE}/api/repos`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ name: "demo", group: "team" }),
  });
  check("重名仓库被拒绝", dup.status === 400);

  const gitUrl = `http://admin%40teamai.local:${encodeURIComponent(token)}@localhost:${PORT}/git/team/demo.git`;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-clone-"));

  let cloneOk = true;
  let cloneErr = "";
  try {
    execFileSync("git", ["clone", gitUrl, workDir], { stdio: "pipe" });
  } catch (e) {
    cloneOk = false;
    cloneErr = String(e.stderr ?? e.message);
  }
  check("git clone（smart HTTP + Basic 鉴权）", cloneOk, cloneErr);

  fs.writeFileSync(path.join(workDir, "hello.md"), "# hello teamai\n");
  execFileSync("git", ["-C", workDir, "add", "."], { stdio: "pipe" });
  execFileSync("git", ["-C", workDir, "-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "-m", "init commit"], { stdio: "pipe" });

  let pushOk = true;
  let pushErr = "";
  try {
    execFileSync("git", ["-C", workDir, "push", "origin", "HEAD:main"], { stdio: "pipe" });
  } catch (e) {
    pushOk = false;
    pushErr = String(e.stderr ?? e.message);
  }
  check("git push 到服务端", pushOk, pushErr);

  let pushEvent = null;
  for (let i = 0; i < 25 && !pushEvent; i++) {
    pushEvent = hookEvents.find((e) => e.body?.event === "push");
    if (!pushEvent) await new Promise((r) => setTimeout(r, 200));
  }
  check("push 触发 webhook 事件", !!pushEvent && pushEvent.body.repo.name === "demo" && pushEvent.body.repo.group === "team", JSON.stringify(hookEvents.map((e) => e.body?.event)));
  check(
    "push 事件包含推送人信息",
    pushEvent?.body?.pusher?.email === "admin@teamai.local",
    JSON.stringify(pushEvent?.body),
  );
  const expectSig = pushEvent
    ? `sha256=${crypto.createHmac("sha256", "whsec").update(pushEvent.raw).digest("hex")}`
    : "";
  check(
    "HMAC 签名校验通过（secret=whsec）",
    !!pushEvent && pushEvent.headers["x-teamai-signature"] === expectSig,
    `got=${pushEvent?.headers?.["x-teamai-signature"]}`,
  );

  const commits = await (await fetch(`${BASE}/api/repos`, { headers: authH })).json();
  const log = await (await fetch(`${BASE}/api/repos/${repoId}/commits`, { headers: authH })).json();
  check(
    "提交历史 API 读到刚才的 commit",
    log.commits.some((c) => c.message === "init commit"),
    JSON.stringify(log),
  );

  const tree = await (await fetch(`${BASE}/api/repos/${repoId}/tree`, { headers: authH })).json();
  check(
    "文件树 API 看到 hello.md",
    tree.tree.some((f) => f && f.path === "hello.md"),
  );

  execFileSync("git", ["-C", workDir, "checkout", "-b", "dev"], { stdio: "pipe" });
  fs.writeFileSync(path.join(workDir, "dev-only.md"), "# dev branch\n");
  execFileSync("git", ["-C", workDir, "add", "."], { stdio: "pipe" });
  execFileSync("git", ["-C", workDir, "-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "-m", "dev commit"], { stdio: "pipe" });
  let branchPush = true;
  try {
    execFileSync("git", ["-C", workDir, "push", "origin", "dev"], { stdio: "pipe" });
  } catch {
    branchPush = false;
  }
  check("推送 dev 分支", branchPush);

  const branches = await (await fetch(`${BASE}/api/repos/${repoId}/branches`, { headers: authH })).json();
  check(
    "分支列表包含 main 和 dev",
    branches.branches.includes("main") && branches.branches.includes("dev"),
    JSON.stringify(branches),
  );

  const devCommits = await (
    await fetch(`${BASE}/api/repos/${repoId}/commits?ref=dev`, { headers: authH })
  ).json();
  check(
    "按分支查提交（dev 独有 commit）",
    devCommits.commits.some((c) => c.message === "dev commit"),
    JSON.stringify(devCommits.commits),
  );

  const devTree = await (
    await fetch(`${BASE}/api/repos/${repoId}/tree?ref=dev`, { headers: authH })
  ).json();
  const mainTree = await (
    await fetch(`${BASE}/api/repos/${repoId}/tree?ref=main`, { headers: authH })
  ).json();
  check(
    "按分支查文件树（dev 有 dev-only.md，main 没有）",
    devTree.tree.some((f) => f && f.path === "dev-only.md") &&
      !mainTree.tree.some((f) => f && f.path === "dev-only.md"),
  );

  let noAuthOk = false;
  try {
    execFileSync("git", ["clone", `${BASE}/git/team/demo.git`, workDir + "-x"], { stdio: "pipe" });
  } catch {
    noAuthOk = true;
  }
  check("无凭证 clone 被拒绝", noAuthOk);

  const delHook = await fetch(`${BASE}/api/repos/${repoId}/webhooks/${hookId}`, { method: "DELETE", headers: authH });
  check("删除 webhook", delHook.status === 200);
  const eventCountBefore = hookEvents.length;
  try {
    execFileSync("git", ["-C", workDir, "checkout", "main"], { stdio: "pipe" });
  } catch {
    execFileSync("git", ["-C", workDir, "checkout", "-b", "main", "origin/main"], { stdio: "pipe" });
  }
  fs.writeFileSync(path.join(workDir, "after-hook-delete.md"), "# no hook\n");
  execFileSync("git", ["-C", workDir, "add", "."], { stdio: "pipe" });
  execFileSync("git", ["-C", workDir, "-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "-m", "after hook delete"], { stdio: "pipe" });
  execFileSync("git", ["-C", workDir, "push", "origin", "main"], { stdio: "pipe" });
  await new Promise((r) => setTimeout(r, 1000));
  check("webhook 删除后 push 不再触发事件", hookEvents.length === eventCountBefore, `before=${eventCountBefore} now=${hookEvents.length}`);

  const del = await fetch(`${BASE}/api/repos/${repoId}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  check("删除仓库", del.status === 200 && !fs.existsSync(path.join(dataDir, "repos", "team", "demo.git")));

  console.log(failed === 0 ? "\nALL GIT E2E TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
} finally {
  server.kill();
  hookReceiver.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
