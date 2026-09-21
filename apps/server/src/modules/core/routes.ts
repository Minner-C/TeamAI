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
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.title, u.department_id, u.created_at,
                d.name AS department_name
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
         ORDER BY u.created_at ASC`,
      )
      .all() as unknown as Array<Record<string, unknown>>;
    return { users: rows };
  });

  app.get("/org/tree", { preHandler: requireUser }, async () => {
    const departments = app.db
      .prepare("SELECT id, name, parent_id, sort, created_at FROM departments ORDER BY sort ASC, created_at ASC")
      .all() as unknown as Array<Record<string, unknown>>;
    const users = app.db
      .prepare(
        "SELECT id, name, email, role, title, department_id FROM users ORDER BY created_at ASC",
      )
      .all() as unknown as Array<Record<string, unknown>>;
    return { departments, users };
  });

  app.post("/admin/departments", { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as { name?: string; parentId?: string | null; sort?: number } | undefined;
    if (!body?.name?.trim()) return reply.code(400).send({ error: "name required" });
    if (body.parentId) {
      const p = app.db.prepare("SELECT id FROM departments WHERE id = ?").get(body.parentId);
      if (!p) return reply.code(400).send({ error: "parent department not found" });
    }
    const id = randomId();
    app.db
      .prepare("INSERT INTO departments (id, name, parent_id, sort, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, body.name.trim(), body.parentId ?? null, body.sort ?? 0, Date.now());
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "department.create",
      target: body.name.trim(),
      ip: req.ip,
    });
    return reply.code(201).send({ id, name: body.name.trim(), parentId: body.parentId ?? null });
  });

  app.patch("/admin/departments/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const dept = app.db.prepare("SELECT id FROM departments WHERE id = ?").get(id);
    if (!dept) return reply.code(404).send({ error: "not found" });
    const body = req.body as { name?: string; parentId?: string | null; sort?: number } | undefined;
    if (body?.parentId === id) return reply.code(400).send({ error: "cannot set parent to self" });
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (body?.name !== undefined && body.name.trim()) { sets.push("name = ?"); vals.push(body.name.trim()); }
    if (body?.parentId !== undefined) { sets.push("parent_id = ?"); vals.push(body.parentId); }
    if (body?.sort !== undefined) { sets.push("sort = ?"); vals.push(body.sort); }
    if (!sets.length) return reply.code(400).send({ error: "nothing to update" });
    vals.push(id);
    app.db.prepare(`UPDATE departments SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as string[]));
    return app.db.prepare("SELECT id, name, parent_id, sort, created_at FROM departments WHERE id = ?").get(id);
  });

  app.delete("/admin/departments/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const children = app.db.prepare("SELECT id FROM departments WHERE parent_id = ?").get(id);
    if (children) return reply.code(400).send({ error: "请先删除或移动子部门" });
    const members = app.db.prepare("SELECT id FROM users WHERE department_id = ? LIMIT 1").get(id);
    if (members) return reply.code(400).send({ error: "部门内仍有成员，请先调整成员归属" });
    const r = app.db.prepare("DELETE FROM departments WHERE id = ?").run(id);
    if (!r.changes) return reply.code(404).send({ error: "not found" });
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "department.delete",
      target: id,
      ip: req.ip,
    });
    return { ok: true };
  });

  app.patch("/admin/users/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = app.db.prepare("SELECT id FROM users WHERE id = ?").get(id);
    if (!user) return reply.code(404).send({ error: "not found" });
    const body = req.body as
      | { name?: string; title?: string; departmentId?: string | null; role?: string }
      | undefined;
    if (body?.departmentId) {
      const d = app.db.prepare("SELECT id FROM departments WHERE id = ?").get(body.departmentId);
      if (!d) return reply.code(400).send({ error: "department not found" });
    }
    if (body?.role !== undefined && !["admin", "member"].includes(body.role)) {
      return reply.code(400).send({ error: "role must be admin or member" });
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (body?.name !== undefined && body.name.trim()) { sets.push("name = ?"); vals.push(body.name.trim()); }
    if (body?.title !== undefined) { sets.push("title = ?"); vals.push(body.title); }
    if (body?.departmentId !== undefined) { sets.push("department_id = ?"); vals.push(body.departmentId); }
    if (body?.role !== undefined) { sets.push("role = ?"); vals.push(body.role); }
    if (!sets.length) return reply.code(400).send({ error: "nothing to update" });
    vals.push(id);
    app.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as string[]));
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "user.update",
      target: id,
      detail: JSON.stringify(body),
      ip: req.ip,
    });
    return app.db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.title, u.department_id, u.created_at,
                d.name AS department_name
         FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`,
      )
      .get(id);
  });

  app.post("/admin/users", { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as
      | { name?: string; email?: string; password?: string; departmentId?: string | null; title?: string }
      | undefined;
    if (!body?.name || !body.email || !body.password) {
      return reply.code(400).send({ error: "name, email, password required" });
    }
    if (body.departmentId) {
      const d = app.db.prepare("SELECT id FROM departments WHERE id = ?").get(body.departmentId);
      if (!d) return reply.code(400).send({ error: "department not found" });
    }
    const exists = app.db.prepare("SELECT id FROM users WHERE email = ?").get(body.email);
    if (exists) return reply.code(409).send({ error: "email already exists" });
    const id = randomId();
    app.db
      .prepare(
        "INSERT INTO users (id, name, email, password_hash, role, title, department_id, created_at) VALUES (?, ?, ?, ?, 'member', ?, ?, ?)",
      )
      .run(id, body.name, body.email, hashPassword(body.password), body.title ?? "", body.departmentId ?? null, Date.now());
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
