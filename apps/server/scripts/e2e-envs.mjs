import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const PORT = await new Promise((resolve) => {
  const s = http.createServer();
  s.listen(0, () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const BASE = `http://localhost:${PORT}`;

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}`, extra ?? "");
  }
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-env-e2e-"));
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  await fetch(`${BASE}/api/admin/users`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ name: "Member", email: "member@teamai.local", password: "member123" }),
  });
  const memberLogin = await (
    await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "member@teamai.local", password: "member123" }),
    })
  ).json();
  const mH = { "content-type": "application/json", authorization: `Bearer ${memberLogin.token}` };
  check("创建成员并登录", !!memberLogin.token);

  const repo = await (
    await fetch(`${BASE}/api/repos`, {
      method: "POST",
      headers: authH,
      body: JSON.stringify({ name: "envdemo", group: "team" }),
    })
  ).json();
  check("创建仓库", !!repo.id);

  const gitUrl = `http://admin%40teamai.local:${encodeURIComponent(token)}@localhost:${PORT}/git/team/envdemo.git`;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-envsrc-"));
  execFileSync("git", ["clone", gitUrl, workDir], { stdio: "pipe" });
  fs.writeFileSync(path.join(workDir, "app.txt"), "hello env\n");
  execFileSync("git", ["-C", workDir, "add", "."], { stdio: "pipe" });
  execFileSync("git", ["-C", workDir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
    stdio: "pipe",
  });
  execFileSync("git", ["-C", workDir, "push", "origin", "HEAD:main"], { stdio: "pipe" });
  check("向仓库推送初始文件", true);

  const env = await (
    await fetch(`${BASE}/api/envs`, {
      method: "POST",
      headers: authH,
      body: JSON.stringify({ name: "测试环境", repoId: repo.id, runCmd: "for i in 1 2 3 4 5 6 7 8 9 10; do echo tick-$i; sleep 0.3; done" }),
    })
  ).json();
  check("从仓库创建环境", !!env.id && env.status === "stopped", JSON.stringify(env));

  const ls = await (
    await fetch(`${BASE}/api/envs/${env.id}/exec`, {
      method: "POST",
      headers: authH,
      body: JSON.stringify({ cmd: "cat app.txt" }),
    })
  ).json();
  check("环境内执行命令读到仓库文件", ls.code === 0 && ls.output.includes("hello env"), JSON.stringify(ls));

  const forbidden = await fetch(`${BASE}/api/envs/${env.id}/exec`, {
    method: "POST",
    headers: mH,
    body: JSON.stringify({ cmd: "id" }),
  });
  check("成员无权操作他人环境", forbidden.status === 404);

  const start = await (
    await fetch(`${BASE}/api/envs/${env.id}/start`, { method: "POST", headers: authH })
  ).json();
  check("启动环境进程", start.ok === true && start.pid > 0, JSON.stringify(start));

  await sleep(1200);
  const logs1 = await (await fetch(`${BASE}/api/envs/${env.id}/logs`, { headers: authH })).json();
  check("运行中可拉取日志", logs1.status === "running" && logs1.lines.some((l) => l.includes("tick-1")), JSON.stringify(logs1).slice(0, 200));

  await sleep(2500);
  const logs2 = await (await fetch(`${BASE}/api/envs/${env.id}/logs`, { headers: authH })).json();
  check("进程退出后状态自动回收", logs2.status === "stopped" && logs2.lines.some((l) => l.includes("exited code=0")), JSON.stringify(logs2).slice(-200));

  const env2 = await (
    await fetch(`${BASE}/api/envs`, {
      method: "POST",
      headers: authH,
      body: JSON.stringify({ name: "长驻环境", runCmd: "sleep 60" }),
    })
  ).json();
  await fetch(`${BASE}/api/envs/${env2.id}/start`, { method: "POST", headers: authH });
  await sleep(300);
  const stop = await (await fetch(`${BASE}/api/envs/${env2.id}/stop`, { method: "POST", headers: authH })).json();
  const logs3 = await (await fetch(`${BASE}/api/envs/${env2.id}/logs`, { headers: authH })).json();
  check("手动停止长驻进程", stop.ok === true && logs3.status === "stopped", JSON.stringify(logs3).slice(-120));

  const list = await (await fetch(`${BASE}/api/envs`, { headers: authH })).json();
  check("环境列表", list.envs.length === 2 && list.envs.every((e) => e.userName === "Admin"), JSON.stringify(list).slice(0, 200));

  fs.writeFileSync(path.join(workDir, "app.txt"), "hello env v2\n");
  execFileSync("git", ["-C", workDir, "add", "."], { stdio: "pipe" });
  execFileSync("git", ["-C", workDir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "v2"], {
    stdio: "pipe",
  });
  execFileSync("git", ["-C", workDir, "push", "origin", "HEAD:main"], { stdio: "pipe" });

  const deploy = await (
    await fetch(`${BASE}/api/envs/${env.id}/deploy`, { method: "POST", headers: authH })
  ).json();
  check("部署接口拉取并返回成功", deploy.ok === true && deploy.log.includes("v2"), JSON.stringify(deploy).slice(0, 200));

  const cat2 = await (
    await fetch(`${BASE}/api/envs/${env.id}/exec`, {
      method: "POST",
      headers: authH,
      body: JSON.stringify({ cmd: "cat app.txt" }),
    })
  ).json();
  check("部署后环境内代码已更新", cat2.output.includes("hello env v2"), JSON.stringify(cat2));

  const envNoRepo = await (
    await fetch(`${BASE}/api/envs`, { method: "POST", headers: authH, body: JSON.stringify({ name: "空环境" }) })
  ).json();
  const deployDenied = await fetch(`${BASE}/api/envs/${envNoRepo.id}/deploy`, { method: "POST", headers: authH });
  check("未关联仓库的环境拒绝部署", deployDenied.status === 400);
  await fetch(`${BASE}/api/envs/${envNoRepo.id}`, { method: "DELETE", headers: authH });

  check("runner 后端自动降级为 process（沙箱无 docker）", list.runner === "process", list.runner);

  const termWs = new WebSocket(`ws://localhost:${PORT}/api/envs/${env.id}/terminal?token=${encodeURIComponent(token)}`);
  const termEvents = [];
  let termOutput = "";
  let termGreeted = false;
  let termExiting = false;
  const termDone = new Promise((resolve) => {
    termWs.on("message", (raw) => {
      const ev = JSON.parse(raw.toString());
      termEvents.push(ev);
      if (ev.type === "output") {
        termOutput += ev.data;
        if (!termGreeted) {
          termGreeted = true;
          termWs.send(JSON.stringify({ type: "input", data: "echo term-$((40+2))\n" }));
        }
        if (termOutput.includes("term-42") && !termExiting) {
          termExiting = true;
          termWs.send(JSON.stringify({ type: "input", data: "exit\n" }));
        }
      }
      if (ev.type === "exit") resolve();
    });
    termWs.on("close", resolve);
  });
  await new Promise((resolve, reject) => {
    termWs.on("open", resolve);
    termWs.on("error", reject);
  });
  await Promise.race([termDone, sleep(8000)]);
  check("终端 WS 鉴权并就绪", termEvents.some((e) => e.type === "ready"), JSON.stringify(termEvents).slice(0, 200));
  check("终端输入执行并返回结果", termOutput.includes("term-42"), termOutput.slice(-200));
  check("终端会话可退出", termEvents.some((e) => e.type === "exit"));

  const badTermWs = new WebSocket(`ws://localhost:${PORT}/api/envs/${env.id}/terminal?token=bad-token`);
  const badTermEv = await new Promise((resolve) => {
    badTermWs.on("message", (raw) => resolve(JSON.parse(raw.toString())));
    badTermWs.on("close", () => resolve(null));
  });
  check("非法 token 终端连接被拒", badTermEv && badTermEv.type === "error");

  const memberTermWs = new WebSocket(`ws://localhost:${PORT}/api/envs/${env.id}/terminal?token=${encodeURIComponent(memberLogin.token)}`);
  const memberTermEv = await new Promise((resolve) => {
    memberTermWs.on("message", (raw) => resolve(JSON.parse(raw.toString())));
    memberTermWs.on("close", () => resolve(null));
  });
  check("成员无法打开他人环境终端", memberTermEv && memberTermEv.type === "error" && memberTermEv.message === "not found");

  const auditDenied = await fetch(`${BASE}/api/admin/audit`, { headers: mH });
  check("成员无法查看审计日志", auditDenied.status === 403);

  const audit = await (await fetch(`${BASE}/api/admin/audit?limit=100`, { headers: authH })).json();
  const actions = new Set(audit.logs.map((l) => l.action));
  const expect = ["auth.login", "user.create", "repo.create", "env.create", "env.start", "env.stop", "env.deploy"];
  check("审计日志覆盖关键操作", expect.every((a) => actions.has(a)), [...actions].join(","));

  const auditFilter = await (await fetch(`${BASE}/api/admin/audit?action=env`, { headers: authH })).json();
  check("审计按动作前缀过滤", auditFilter.logs.length >= 4 && auditFilter.logs.every((l) => l.action.startsWith("env.")));

  const del = await fetch(`${BASE}/api/envs/${env.id}`, { method: "DELETE", headers: authH });
  const del2 = await fetch(`${BASE}/api/envs/${env2.id}`, { method: "DELETE", headers: authH });
  check("删除环境", del.status === 200 && del2.status === 200);
  check("环境工作区已清理", !fs.existsSync(path.join(dataDir, "envs", env.id)));
} finally {
  server.kill("SIGTERM");
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
