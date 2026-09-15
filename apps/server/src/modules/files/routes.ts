import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { requireUser } from "../core/auth.js";
import { verifyToken, randomId } from "../core/crypto.js";
import type { Db } from "../../db.js";

interface FileRow {
  id: string;
  owner_id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  created_at: number;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const SAFE_NAME_RE = /[^\w.一-龥-]+/g;

function filesDir(dataDir: string): string {
  return path.join(dataDir, "files");
}

function getFile(db: Db, id: string): FileRow | undefined {
  const safeId = /^[a-z0-9]{24}$/.test(id) ? id : "";
  if (!safeId) return undefined;
  return db.prepare("SELECT * FROM files WHERE id = ?").get(safeId) as FileRow | undefined;
}

export async function fileRoutes(app: FastifyInstance) {
  fs.mkdirSync(filesDir(app.config.dataDir), { recursive: true });

  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/", { preHandler: requireUser }, async (req, reply) => {
    const rawName = decodeURIComponent(String(req.headers["x-file-name"] ?? "file"));
    const name = rawName.replace(SAFE_NAME_RE, "_").slice(-128) || "file";
    const mime = String(req.headers["content-type"] ?? "application/octet-stream").split(";")[0];
    const rawBody = req.body as Buffer | string | undefined;
    const body = Buffer.isBuffer(rawBody) ? rawBody : typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : null;
    if (!body || body.length === 0) {
      return reply.code(400).send({ error: "file body required" });
    }
    if (body.length > MAX_FILE_SIZE) return reply.code(413).send({ error: "file too large (max 20MB)" });

    const id = randomId();
    const diskPath = path.join(filesDir(app.config.dataDir), id);
    await fs.promises.writeFile(diskPath, body);
    app.db
      .prepare(
        "INSERT INTO files (id, owner_id, name, mime, size, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, req.user!.id, name, mime, body.length, diskPath, Date.now());
    return reply.code(201).send({ id, name, mime, size: body.length });
  });

  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const headerToken = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;
    const queryToken = (req.query as { token?: string }).token ?? null;
    const token = headerToken ?? queryToken;
    if (!token || !verifyToken(token, app.config.jwtSecret)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const row = getFile(app.db, id);
    if (!row || !fs.existsSync(row.path)) return reply.code(404).send({ error: "not found" });
    reply.header("content-type", row.mime);
    reply.header(
      "content-disposition",
      `${row.mime.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    );
    return reply.send(fs.createReadStream(row.path));
  });
}
