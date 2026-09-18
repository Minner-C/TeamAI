import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { spawn } from "node:child_process";
import { verifyToken } from "../core/crypto.js";
import { canAccessRepo, findRepo, validRepoPart } from "./store.js";

function authenticate(app: FastifyInstance, req: FastifyRequest): string | null {
  const h = req.headers.authorization ?? "";
  if (h.startsWith("Basic ")) {
    const decoded = Buffer.from(h.slice(6), "base64").toString("utf8");
    const password = decoded.split(":").slice(1).join(":");
    const payload = verifyToken(password, app.config.jwtSecret);
    if (payload) return payload.uid;
    const key = req.server.db
      .prepare("SELECT user_id FROM virtual_keys WHERE key = ? AND revoked_at IS NULL")
      .get(password) as { user_id: string } | undefined;
    return key?.user_id ?? null;
  }
  if (h.startsWith("Bearer ")) {
    const payload = verifyToken(h.slice(7).trim(), app.config.jwtSecret);
    return payload?.uid ?? null;
  }
  return null;
}

export async function gitSmartHttp(app: FastifyInstance) {
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.route({
    method: ["GET", "POST"],
    url: "/git/*",
    handler: (req, reply) => handleGit(app, req, reply),
  });
}

async function handleGit(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply) {
  const uid = authenticate(app, req);
  if (!uid) {
    return reply
      .code(401)
      .header("www-authenticate", 'Basic realm="teamai"')
      .send({ error: "authentication required" });
  }

  const wildcard = (req.params as Record<string, string>)["*"] ?? "";
  const m = wildcard.match(/^([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\.git(\/.*)?$/);
  if (!m || wildcard.includes("..")) {
    return reply.code(404).send({ error: "repo not found" });
  }
  const [, grp, name] = m;
  if (!validRepoPart(grp) || !validRepoPart(name)) {
    return reply.code(404).send({ error: "repo not found" });
  }
  const repo = findRepo(app.db, grp, name);
  if (!repo) {
    return reply.code(404).send({ error: "repo not found" });
  }
  const user = app.db.prepare("SELECT role FROM users WHERE id = ?").get(uid) as
    | { role: string }
    | undefined;
  if (!user || !canAccessRepo(app.db, repo, uid, user.role === "admin")) {
    return reply.code(403).send({ error: "no access to this repo" });
  }

  const query = req.url.split("?")[1] ?? "";
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  const child = spawn("git", ["http-backend"], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: app.config.reposDir,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: `/${grp}/${name}.git${m[3] ?? ""}`,
      REQUEST_METHOD: req.method,
      QUERY_STRING: query,
      CONTENT_TYPE: (req.headers["content-type"] as string) ?? "",
      CONTENT_LENGTH: String(body.length),
      REMOTE_USER: uid,
    },
  });

  const chunks: Buffer[] = [];
  child.stdout.on("data", (c: Buffer) => chunks.push(c));
  const errChunks: Buffer[] = [];
  child.stderr.on("data", (c: Buffer) => errChunks.push(c));

  const code = await new Promise<number>((resolve) => {
    child.on("close", resolve);
    child.stdin.write(body);
    child.stdin.end();
  });

  if (code !== 0) {
    req.log.error({ stderr: Buffer.concat(errChunks).toString() }, "git http-backend failed");
    return reply.code(502).send({ error: "git backend error" });
  }

  const out = Buffer.concat(chunks);
  const sep = out.indexOf("\r\n\r\n");
  if (sep === -1) return reply.code(502).send({ error: "bad cgi response" });

  const headerBlock = out.subarray(0, sep).toString("latin1");
  const payload = out.subarray(sep + 4);

  let status = 200;
  reply.hijack();
  for (const line of headerBlock.split("\r\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    if (k === "status") {
      status = Number(v.split(" ")[0]) || 200;
    } else {
      reply.raw.setHeader(k, v);
    }
  }
  reply.raw.writeHead(status);
  reply.raw.end(payload);
}
