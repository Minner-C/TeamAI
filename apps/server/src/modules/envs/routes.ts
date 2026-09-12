import type { FastifyInstance } from "fastify";
import { requireUser } from "../core/auth.js";
import { recordAudit } from "../audit/store.js";
import { createEnv, deleteEnv, getEnv, listEnvs, toEnvView } from "./store.js";
import { envLogs, execInEnv, isRunning, startEnv, stopEnv } from "./runner.js";

function canAccess(envUserId: string, reqUser: { id: string; role: string }): boolean {
  return envUserId === reqUser.id || reqUser.role === "admin";
}

export async function envRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: requireUser }, async (req) => {
    const all = req.user!.role === "admin" && (req.query as { all?: string }).all === "1";
    const rows = listEnvs(app.db, all ? undefined : req.user!.id);
    return {
      envs: rows.map((r) => ({
        ...toEnvView(app.db, r),
        status: isRunning(r.id) ? "running" : r.status === "running" ? "stopped" : r.status,
      })),
    };
  });

  app.post("/", { preHandler: requireUser }, async (req, reply) => {
    const body = req.body as { name?: string; repoId?: string; runCmd?: string } | undefined;
    if (!body?.name) return reply.code(400).send({ error: "name required" });
    try {
      const row = await createEnv(app.db, app.config.dataDir, {
        name: body.name,
        repoId: body.repoId,
        userId: req.user!.id,
        runCmd: body.runCmd,
      });
      recordAudit(app.db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: "env.create",
        target: row.name,
        detail: body.repoId ? `repo=${body.repoId}` : "empty",
        ip: req.ip,
      });
      return reply.code(201).send(toEnvView(app.db, row));
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "create failed" });
    }
  });

  app.post("/:id/start", { preHandler: requireUser }, async (req, reply) => {
    const env = getEnv(app.db, (req.params as { id: string }).id);
    if (!env || !canAccess(env.user_id, req.user!)) return reply.code(404).send({ error: "not found" });
    try {
      const { pid } = startEnv(app.db, env);
      recordAudit(app.db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: "env.start",
        target: env.name,
        detail: env.run_cmd,
        ip: req.ip,
      });
      return { ok: true, pid };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "start failed" });
    }
  });

  app.post("/:id/stop", { preHandler: requireUser }, async (req, reply) => {
    const env = getEnv(app.db, (req.params as { id: string }).id);
    if (!env || !canAccess(env.user_id, req.user!)) return reply.code(404).send({ error: "not found" });
    stopEnv(app.db, env);
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "env.stop",
      target: env.name,
      ip: req.ip,
    });
    return { ok: true };
  });

  app.get("/:id/logs", { preHandler: requireUser }, async (req, reply) => {
    const env = getEnv(app.db, (req.params as { id: string }).id);
    if (!env || !canAccess(env.user_id, req.user!)) return reply.code(404).send({ error: "not found" });
    const tail = Number((req.query as { tail?: string }).tail ?? 200);
    return { status: isRunning(env.id) ? "running" : env.status, lines: envLogs(env.id, tail) };
  });

  app.post("/:id/exec", { preHandler: requireUser }, async (req, reply) => {
    const env = getEnv(app.db, (req.params as { id: string }).id);
    if (!env || !canAccess(env.user_id, req.user!)) return reply.code(404).send({ error: "not found" });
    const body = req.body as { cmd?: string } | undefined;
    if (!body?.cmd?.trim()) return reply.code(400).send({ error: "cmd required" });
    const result = await execInEnv(env, body.cmd);
    return result;
  });

  app.delete("/:id", { preHandler: requireUser }, async (req, reply) => {
    const env = getEnv(app.db, (req.params as { id: string }).id);
    if (!env || !canAccess(env.user_id, req.user!)) return reply.code(404).send({ error: "not found" });
    if (isRunning(env.id)) stopEnv(app.db, env);
    await deleteEnv(app.db, env.id);
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "env.delete",
      target: env.name,
      ip: req.ip,
    });
    return { ok: true };
  });
}
