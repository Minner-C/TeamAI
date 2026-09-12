import type { FastifyInstance } from "fastify";
import { hashPassword, randomId, verifyPassword, signToken } from "./crypto.js";
import { requireAdmin, requireUser } from "./auth.js";
import { recordAudit } from "../audit/store.js";
import type { UserRow } from "../../types.js";

const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

export async function coreRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req, reply) => {
    const body = req.body as { email?: string; password?: string } | undefined;
    if (!body?.email || !body?.password) {
      return reply.code(400).send({ error: "email and password required" });
    }
    const user = app.db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(body.email) as UserRow | undefined;
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      recordAudit(app.db, { action: "auth.login_failed", target: body.email, ip: req.ip });
      return reply.code(401).send({ error: "invalid credentials" });
    }
    const token = signToken({ uid: user.id, exp: Date.now() + TOKEN_TTL_MS }, app.config.jwtSecret);
    recordAudit(app.db, { userId: user.id, userEmail: user.email, action: "auth.login", ip: req.ip });
    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  });

  app.get("/me", { preHandler: requireUser }, async (req) => {
    const u = req.user!;
    return { id: u.id, name: u.name, email: u.email, role: u.role };
  });

  app.get("/users", { preHandler: requireUser }, async () => {
    const rows = app.db
      .prepare("SELECT id, name, email, role, created_at FROM users ORDER BY created_at ASC")
      .all() as unknown as Array<Pick<UserRow, "id" | "name" | "email" | "role" | "created_at">>;
    return { users: rows };
  });

  app.post("/admin/users", { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as { name?: string; email?: string; password?: string } | undefined;
    if (!body?.name || !body.email || !body.password) {
      return reply.code(400).send({ error: "name, email, password required" });
    }
    const exists = app.db.prepare("SELECT id FROM users WHERE email = ?").get(body.email);
    if (exists) return reply.code(409).send({ error: "email already exists" });
    const id = randomId();
    app.db
      .prepare("INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'member', ?)")
      .run(id, body.name, body.email, hashPassword(body.password), Date.now());
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "user.create",
      target: body.email,
      detail: body.name,
      ip: req.ip,
    });
    return reply.code(201).send({ id, name: body.name, email: body.email, role: "member" });
  });
}
