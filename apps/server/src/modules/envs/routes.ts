import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireUser } from "../core/auth.js";
import { recordAudit } from "../audit/store.js";
import { createEnv, deleteEnv, getEnv, listEnvs, toEnvView } from "./store.js";
import { currentBackend, envLogs, execInEnv, isRunning, startEnv, stopEnv } from "./runner.js";

const execFileAsync = promisify(execFile);

async function gitIn(cwd: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });
  return `${stdout}${stderr}`.trim();
}

function canAccess(envUserId: string, reqUser: { id: string; role: string }): boolean {
  return envUserId === reqUser.id || reqUser.role === "admin";
}

export async function envRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: requireUser }, async (req) => {
    const all = req.user!.role === "admin" && (req.query as { all?: string }).all === "1";
    const rows = listEnvs(app.db, all ? undefined : req.user!.id);
    return {
      runner: currentBackend(),
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
        isAdmin: req.user!.role === "admin",
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
      const { pid } = await startEnv(app.db, env);
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
    await stopEnv(app.db, env);
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "env.stop",
      target: env.name,
      ip: req.ip,
    });
    return { ok: true };
  });

  app.post("/:id/deploy", { preHandler: requireUser }, async (req, reply) => {
    const env = getEnv(app.db, (req.params as { id: string }).id);
    if (!env || !canAccess(env.user_id, req.user!)) return reply.code(404).send({ error: "not found" });
    if (!env.repo_id) return reply.code(400).send({ error: "该环境未关联仓库，无法拉取代码" });
    const logs: string[] = [];
    try {
      const branch = (await gitIn(env.workdir, ["rev-parse", "--abbrev-ref", "HEAD"])) || "main";
      logs.push(await gitIn(env.workdir, ["fetch", "origin"]));
      logs.push(await gitIn(env.workdir, ["reset", "--hard", `origin/${branch}`]));
      const head = await gitIn(env.workdir, ["log", "-1", "--pretty=format:%h %s (%an)"]);
      logs.push(`[teamai] 已同步到 ${head}`);
      let started = false;
      if (env.run_cmd.trim()) {
        if (isRunning(env.id)) {
          await stopEnv(app.db, env);
          logs.push("[teamai] 已停止旧进程");
        }
        const { pid } = await startEnv(app.db, env);
        started = true;
        logs.push(`[teamai] 已启动: ${env.run_cmd}${pid ? ` (pid ${pid})` : ""}`);
      }
      recordAudit(app.db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: "env.deploy",
        target: env.name,
        detail: head,
        ip: req.ip,
      });
      return { ok: true, started, log: logs.filter(Boolean).join("\n") };
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : "deploy failed",
        log: logs.filter(Boolean).join("\n"),
      });
    }
  });

  app.get("/:id/logs", { preHandler: requireUser }, async (req, reply) => {
    const env = getEnv(app.db, (req.params as { id: string }).id);
    if (!env || !canAccess(env.user_id, req.user!)) return reply.code(404).send({ error: "not found" });
    const tail = Number((req.query as { tail?: string }).tail ?? 200);
    return { status: isRunning(env.id) ? "running" : env.status, lines: await envLogs(env.id, tail) };
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
    if (isRunning(env.id)) await stopEnv(app.db, env);
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
