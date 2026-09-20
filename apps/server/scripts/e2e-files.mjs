import { spawn } from "node:child_process";
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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-files-e2e-"));
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

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

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

  const up = await fetch(`${BASE}/api/files`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "image/png",
      "x-file-name": encodeURIComponent("像素图.png"),
    },
    body: PNG_1PX,
  });
  const file = await up.json();
  check("上传 PNG 文件", up.status === 201 && file.name === "像素图.png" && file.size === PNG_1PX.length, JSON.stringify(file));

  const noAuth = await fetch(`${BASE}/api/files/${file.id}`);
  check("未授权下载被拒", noAuth.status === 401);

  const dl = await fetch(`${BASE}/api/files/${file.id}`, { headers: { authorization: `Bearer ${token}` } });
  const dlBuf = Buffer.from(await dl.arrayBuffer());
  check("Bearer 下载且内容一致", dl.status === 200 && dlBuf.equals(PNG_1PX), `status=${dl.status} size=${dlBuf.length}`);
  check("图片 inline 展示", (dl.headers.get("content-disposition") ?? "").startsWith("inline"));

  const dlQ = await fetch(`${BASE}/api/files/${file.id}?token=${encodeURIComponent(token)}`);
  check("query token 下载（供 <img> 使用）", dlQ.status === 200);

  const traversal = await fetch(`${BASE}/api/files/..%2f..%2fteamai.db?token=${encodeURIComponent(token)}`);
  check("路径穿越被拒绝", traversal.status === 404 || traversal.status === 401);

  await fetch(`${BASE}/api/admin/users`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ name: "Member", email: "member@teamai.local", password: "member123" }),
  });
  const users = await (await fetch(`${BASE}/api/users`, { headers: authH })).json();
  const memberId = users.users.find((u) => u.email === "member@teamai.local")?.id;

  const ch = await (
    await fetch(`${BASE}/api/channels`, {
      method: "POST",
      headers: authH,
      body: JSON.stringify({ type: "group", name: "文件测试群", memberIds: [memberId] }),
    })
  ).json();
  check("创建群", !!ch.id, JSON.stringify(ch));

  const msg = await (
    await fetch(`${BASE}/api/channels/${ch.id}/messages`, {
      method: "POST",
      headers: authH,
      body: JSON.stringify({
        content: file.name,
        type: "image",
        payload: { fileId: file.id, name: file.name, size: file.size, mime: "image/png" },
      }),
    })
  ).json();
  check(
    "发送图片消息",
    msg.type === "image" && msg.payload?.fileId === file.id,
    JSON.stringify(msg),
  );

  const list = await (await fetch(`${BASE}/api/channels/${ch.id}/messages`, { headers: authH })).json();
  check(
    "历史消息保留 payload",
    list.messages.some((m) => m.type === "image" && m.payload?.fileId === file.id),
  );

  const tooBig = await fetch(`${BASE}/api/files`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      "x-file-name": "big.bin",
    },
    body: Buffer.alloc(21 * 1024 * 1024, 1),
  });
  check("超限文件被拒（>20MB）", tooBig.status === 413, `status=${tooBig.status}`);

  const memberLogin = await (
    await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "member@teamai.local", password: "member123" }),
    })
  ).json();
  const memberToken = memberLogin.token;
  const memberH = { "content-type": "application/json", authorization: `Bearer ${memberToken}` };
  check("成员登录", !!memberToken);

  const memberUp = await fetch(`${BASE}/api/files`, {
    method: "POST",
    headers: { authorization: `Bearer ${memberToken}`, "content-type": "text/plain", "x-file-name": "note.txt" },
    body: "hello from member",
  });
  const memberFile = await memberUp.json();
  check("成员上传文件", memberUp.status === 201 && !!memberFile.id);

  const memberList = await (await fetch(`${BASE}/api/files`, { headers: memberH })).json();
  check(
    "成员列表仅含自己的文件",
    memberList.files.length === 1 && memberList.files[0].id === memberFile.id && memberList.admin === false,
    JSON.stringify(memberList),
  );

  const adminList = await (await fetch(`${BASE}/api/files?all=1`, { headers: authH })).json();
  check(
    "管理员列表含全部文件且带上传者信息",
    adminList.admin === true &&
      adminList.files.length === 2 &&
      adminList.files.every((f) => f.ownerName && f.createdAt),
    JSON.stringify(adminList.files),
  );

  const denyDel = await fetch(`${BASE}/api/files/${file.id}`, { method: "DELETE", headers: memberH });
  check("成员删除他人文件被拒", denyDel.status === 403, `status=${denyDel.status}`);

  const memberDel = await fetch(`${BASE}/api/files/${memberFile.id}`, { method: "DELETE", headers: memberH });
  const afterMemberDel = await fetch(`${BASE}/api/files/${memberFile.id}`, { headers: memberH });
  check("成员删除自己的文件", memberDel.status === 200 && afterMemberDel.status === 404);

  const adminDel = await fetch(`${BASE}/api/files/${file.id}`, { method: "DELETE", headers: authH });
  const afterAdminDel = await fetch(`${BASE}/api/files/${file.id}`, { headers: authH });
  check("管理员删除成员文件", adminDel.status === 200 && afterAdminDel.status === 404);

  const audit = await (await fetch(`${BASE}/api/admin/audit?limit=50`, { headers: authH })).json();
  check("审计含 file.delete", audit.logs.filter((l) => l.action === "file.delete").length >= 2);
} finally {
  server.kill("SIGTERM");
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
