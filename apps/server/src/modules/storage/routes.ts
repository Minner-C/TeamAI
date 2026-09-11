import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { requireUser } from "../core/auth.js";
import { randomId } from "../core/crypto.js";

interface SessionRow {
  id: string;
  user_id: string;
  task_id: string;
  cli: string;
  title: string;
  archive_path: string;
  meta_json: string;
  created_at: number;
}

export async function storageRoutes(app: FastifyInstance) {
  const archivesDir = path.join(app.config.dataDir, "archives");
  fs.mkdirSync(archivesDir, { recursive: true });

  app.post("/sessions", { preHandler: requireUser }, async (req, reply) => {
    const body = req.body as
      | { title?: string; cli?: string; taskId?: string; messages?: unknown[]; meta?: Record<string, unknown> }
      | undefined;
    if (!body?.messages?.length) return reply.code(400).send({ error: "messages required" });
    const id = randomId();
    const archivePath = path.join(archivesDir, `${id}.jsonl`);
    fs.writeFileSync(archivePath, body.messages.map((m) => JSON.stringify(m)).join("\n"));
    app.db
      .prepare(
        "INSERT INTO sessions (id, user_id, task_id, cli, title, archive_path, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        req.user!.id,
        body.taskId ?? "",
        body.cli ?? "",
        body.title ?? `会话 ${new Date().toLocaleString("zh-CN")}`,
        archivePath,
        JSON.stringify(body.meta ?? {}),
        Date.now(),
      );
    return reply.code(201).send({ id });
  });

  app.get("/sessions", { preHandler: requireUser }, async (req) => {
    const rows = (
      req.user!.role === "admin"
        ? app.db.prepare("SELECT * FROM sessions ORDER BY created_at DESC LIMIT 200").all()
        : app.db
            .prepare("SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200")
            .all(req.user!.id)
    ) as unknown as SessionRow[];
    return {
      sessions: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        taskId: r.task_id,
        cli: r.cli,
        title: r.title,
        createdAt: r.created_at,
      })),
    };
  });

  app.get("/sessions/:id", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = app.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | SessionRow
      | undefined;
    if (!row || (row.user_id !== req.user!.id && req.user!.role !== "admin")) {
      return reply.code(404).send({ error: "not found" });
    }
    const content = fs.existsSync(row.archive_path)
      ? fs.readFileSync(row.archive_path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    return { id: row.id, title: row.title, messages: content };
  });
}
