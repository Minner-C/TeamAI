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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-acl-e2e-"));
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

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json()).token;
}
const jsonH = (token) => ({ "content-type": "application/json", authorization: `Bearer ${token}` });

try {
  const adminToken = await login("admin@teamai.local", "admin123");
  const adminH = jsonH(adminToken);
  check("管理员登录", !!adminToken);

  const memberRes = await fetch(`${BASE}/api/admin/users`, {
    method: "POST",
    headers: adminH,
    body: JSON.stringify({ name: "小红", email: "hong@teamai.local", password: "pw123456" }),
  });
  const member = await memberRes.json();
  const memberToken = await login("hong@teamai.local", "pw123456");
  const memberH = jsonH(memberToken);
  check("创建并登录成员", memberRes.status === 201 && !!memberToken);

  const pubRes = await fetch(`${BASE}/api/repos`, {
    method: "POST",
    headers: adminH,
    body: JSON.stringify({ name: "open-proj", group: "team" }),
  });
  check("创建团队可见仓库", pubRes.status === 201, await pubRes.clone().text());

  const privRes = await fetch(`${BASE}/api/repos`, {
    method: "POST",
    headers: adminH,
    body: JSON.stringify({ name: "secret-proj", group: "team", visibility: "private" }),
  });
  const privRepo = await privRes.json();
  check(
    "创建私有仓库",
    privRes.status === 201 && privRepo.visibility === "private" && privRepo.memberCount === 1,
    JSON.stringify(privRepo),
  );

  const adminList = await (await fetch(`${BASE}/api/repos`, { headers: adminH })).json();
  check("管理员可见全部仓库", adminList.repos.length === 2);

  const memberList = await (await fetch(`${BASE}/api/repos`, { headers: memberH })).json();
  check(
    "成员列表不含私有仓库",
    memberList.repos.length === 1 && memberList.repos[0].name === "open-proj",
    JSON.stringify(memberList.repos.map((r) => r.name)),
  );

  const noAccessCommits = await fetch(`${BASE}/api/repos/${privRepo.id}/commits`, { headers: memberH });
  check("成员访问私有仓库 commits 被 403", noAccessCommits.status === 403);

  const noAccessTree = await fetch(`${BASE}/api/repos/${privRepo.id}/tree`, { headers: memberH });
  check("成员访问私有仓库 tree 被 403", noAccessTree.status === 403);

  let cloneDenied = false;
  const memberCloneUrl = `http://hong%40teamai.local:${encodeURIComponent(memberToken)}@localhost:${PORT}/git/team/secret-proj.git`;
  try {
    execFileSync("git", ["clone", memberCloneUrl, fs.mkdtempSync(path.join(os.tmpdir(), "acl-x-"))], { stdio: "pipe" });
  } catch {
    cloneDenied = true;
  }
  check("成员 clone 私有仓库被拒（smart HTTP 403）", cloneDenied);

  const addByMember = await fetch(`${BASE}/api/repos/${privRepo.id}/members`, {
    method: "POST",
    headers: memberH,
    body: JSON.stringify({ userId: member.id }),
  });
  check("非 owner 不能管理成员", addByMember.status === 403);

  const addRes = await fetch(`${BASE}/api/repos/${privRepo.id}/members`, {
    method: "POST",
    headers: adminH,
    body: JSON.stringify({ userId: member.id }),
  });
  check("owner/admin 添加仓库成员", addRes.status === 200);

  const members = await (await fetch(`${BASE}/api/repos/${privRepo.id}/members`, { headers: adminH })).json();
  check(
    "成员列表正确（owner + member）",
    members.members.length === 2 && members.members.some((m) => m.role === "owner"),
    JSON.stringify(members),
  );

  const memberList2 = await (await fetch(`${BASE}/api/repos`, { headers: memberH })).json();
  check("加入后成员可见私有仓库", memberList2.repos.some((r) => r.name === "secret-proj"));

  const accessCommits = await fetch(`${BASE}/api/repos/${privRepo.id}/commits`, { headers: memberH });
  check("加入后成员可读 commits", accessCommits.status === 200);

  let cloneOk = true;
  let cloneErr = "";
  try {
    execFileSync("git", ["clone", memberCloneUrl, fs.mkdtempSync(path.join(os.tmpdir(), "acl-y-"))], { stdio: "pipe" });
  } catch (e) {
    cloneOk = false;
    cloneErr = String(e.stderr ?? e.message);
  }
  check("加入后成员可 clone 私有仓库", cloneOk, cloneErr);

  const memberDel = await fetch(`${BASE}/api/repos/${privRepo.id}`, { method: "DELETE", headers: memberH });
  check("普通成员不能删除他人仓库", memberDel.status === 403);

  const rmRes = await fetch(`${BASE}/api/repos/${privRepo.id}/members/${member.id}`, {
    method: "DELETE",
    headers: adminH,
  });
  check("移除仓库成员", rmRes.status === 200);

  const memberList3 = await (await fetch(`${BASE}/api/repos`, { headers: memberH })).json();
  check("移除后成员再次不可见", !memberList3.repos.some((r) => r.name === "secret-proj"));

  const rmOwner = await fetch(
    `${BASE}/api/repos/${privRepo.id}/members/${(await (await fetch(`${BASE}/api/repos/${privRepo.id}/members`, { headers: adminH })).json()).members.find((m) => m.role === "owner").userId}`,
    { method: "DELETE", headers: adminH },
  );
  check("owner 不可被移除", rmOwner.status === 400);

  const toTeam = await fetch(`${BASE}/api/repos/${privRepo.id}/visibility`, {
    method: "PATCH",
    headers: adminH,
    body: JSON.stringify({ visibility: "team" }),
  });
  check("私有仓库改为团队可见", toTeam.status === 200);

  const memberList4 = await (await fetch(`${BASE}/api/repos`, { headers: memberH })).json();
  check("改为团队可见后成员可见", memberList4.repos.some((r) => r.name === "secret-proj"));

  const badVis = await fetch(`${BASE}/api/repos/${privRepo.id}/visibility`, {
    method: "PATCH",
    headers: adminH,
    body: JSON.stringify({ visibility: "public" }),
  });
  check("非法 visibility 被拒", badVis.status === 400);

  const envFromPriv = await fetch(`${BASE}/api/envs`, {
    method: "POST",
    headers: jsonH(memberToken),
    body: JSON.stringify({ name: "越权环境", repoId: privRepo.id }),
  });
  check("对无权限私有仓库建环境（team 可见后可建）", envFromPriv.status === 201 || envFromPriv.status === 400);

  await fetch(`${BASE}/api/repos/${privRepo.id}/visibility`, {
    method: "PATCH",
    headers: adminH,
    body: JSON.stringify({ visibility: "private" }),
  });
  const envDenied = await fetch(`${BASE}/api/envs`, {
    method: "POST",
    headers: jsonH(memberToken),
    body: JSON.stringify({ name: "越权环境2", repoId: privRepo.id }),
  });
  check("私有仓库恢复私有后成员建环境被拒", envDenied.status === 400, String(envDenied.status));

  const audit = await (await fetch(`${BASE}/api/admin/audit?action=repo&limit=50`, { headers: adminH })).json();
  check(
    "审计记录包含仓库权限操作",
    audit.logs.some((l) => l.action === "repo.member_add") && audit.logs.some((l) => l.action === "repo.visibility"),
    JSON.stringify(audit.logs.map((l) => l.action)),
  );

  console.log(failed === 0 ? "\nALL REPO ACL E2E TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
