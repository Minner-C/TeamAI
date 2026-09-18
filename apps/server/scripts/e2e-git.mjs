import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
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
const BASE = `http://localhost:${PORT}`;

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

  const commits = await (await fetch(`${BASE}/api/repos`, { headers: authH })).json();
  const repoId = commits.repos[0].id;
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

  const del = await fetch(`${BASE}/api/repos/${repoId}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  check("删除仓库", del.status === 200 && !fs.existsSync(path.join(dataDir, "repos", "team", "demo.git")));

  console.log(failed === 0 ? "\nALL GIT E2E TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
