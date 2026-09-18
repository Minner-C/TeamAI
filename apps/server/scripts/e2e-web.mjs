import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}`, extra ?? "");
  }
}

async function startServer(port, webDir) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-web-e2e-"));
  const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      TEAMAI_PORT: String(port),
      TEAMAI_DATA_DIR: dataDir,
      TEAMAI_WEB_DIR: webDir,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(d));
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return { server, dataDir };
}

const webDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamai-webdist-"));
fs.writeFileSync(path.join(webDir, "index.html"), "<!doctype html><title>TeamAI Web</title><div id=root></div>");
fs.mkdirSync(path.join(webDir, "assets"));
fs.writeFileSync(path.join(webDir, "assets", "app.js"), "console.log('teamai-web-ok')");
fs.writeFileSync(path.join(webDir, "assets", "app.css"), "body{margin:0}");

const PORT_A = await freePort();
const PORT_B = await freePort();
const a = await startServer(PORT_A, webDir);
const b = await startServer(PORT_B, "/nonexistent-web-dir");
const A = `http://localhost:${PORT_A}`;
const B = `http://localhost:${PORT_B}`;

try {
  const root = await fetch(`${A}/`);
  check("GET / 返回 Web 客户端 index.html", root.status === 200 && (await root.text()).includes("TeamAI Web"));

  const js = await fetch(`${A}/assets/app.js`);
  check(
    "静态资源 js 正常服务且 MIME 正确",
    js.status === 200 &&
      (js.headers.get("content-type") ?? "").includes("javascript") &&
      (await js.text()).includes("teamai-web-ok"),
  );

  const css = await fetch(`${A}/assets/app.css`);
  check("静态资源 css MIME 正确", css.status === 200 && (css.headers.get("content-type") ?? "").includes("text/css"));

  const spa = await fetch(`${A}/im/channel/abc`);
  check("SPA  fallback：未知前端路由返回 index.html", spa.status === 200 && (await spa.text()).includes("TeamAI Web"));

  const traversal = await fetch(`${A}/..%2f..%2fetc%2fpasswd`);
  const traversalBody = await traversal.text();
  check(
    "路径穿越被拦截",
    !traversalBody.includes("root:") && (traversal.status === 404 || traversalBody.includes("TeamAI Web")),
    `status=${traversal.status}`,
  );

  const api404 = await fetch(`${A}/api/definitely-not-here`);
  check("API 路径不受 SPA fallback 影响", api404.status === 404, String(api404.status));

  const admin = await fetch(`${A}/admin`);
  check("管理控制台仍可访问", admin.status === 200 && (await admin.text()).includes("login-logo"));

  const bRoot = await fetch(`${B}/`, { redirect: "manual" });
  check(
    "无 Web 构建产物时 / 重定向到 /admin",
    bRoot.status === 302 && (bRoot.headers.get("location") ?? "").includes("/admin"),
    `status=${bRoot.status} loc=${bRoot.headers.get("location")}`,
  );

  const bSpa = await fetch(`${B}/im/channel/abc`);
  check("无 Web 产物时前端路由 404", bSpa.status === 404);

  console.log(failed === 0 ? "\nALL WEB E2E TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
} finally {
  a.server.kill();
  b.server.kill();
  fs.rmSync(a.dataDir, { recursive: true, force: true });
  fs.rmSync(b.dataDir, { recursive: true, force: true });
  fs.rmSync(webDir, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
