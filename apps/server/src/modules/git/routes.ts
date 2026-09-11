import type { FastifyInstance } from "fastify";
import { requireUser } from "../core/auth.js";
import { createRepo, deleteRepo, listRepos, repoCommits, repoTree, type RepoRow } from "./store.js";
import type { UserRow } from "../../types.js";

function toView(r: RepoRow) {
  return { id: r.id, name: r.name, group: r.grp, ownerId: r.owner_id, createdAt: r.created_at };
}

export async function gitRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: requireUser }, async () => ({
    repos: listRepos(app.db).map(toView),
  }));

  app.post("/", { preHandler: requireUser }, async (req, reply) => {
    const body = req.body as { name?: string; group?: string } | undefined;
    if (!body?.name) return reply.code(400).send({ error: "name required" });
    try {
      const row = await createRepo(app.db, app.config.reposDir, {
        name: body.name,
        grp: body.group ?? "default",
        ownerId: (req.user as UserRow).id,
      });
      return reply.code(201).send(toView(row));
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "create failed" });
    }
  });

  app.delete("/:id", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = app.db.prepare("SELECT * FROM repos WHERE id = ?").get(id) as RepoRow | undefined;
    if (!row) return reply.code(404).send({ error: "not found" });
    const user = req.user as UserRow;
    if (row.owner_id !== user.id && user.role !== "admin") {
      return reply.code(403).send({ error: "only owner or admin can delete" });
    }
    await deleteRepo(app.db, id);
    return { ok: true };
  });

  app.get("/:id/commits", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = app.db.prepare("SELECT * FROM repos WHERE id = ?").get(id) as RepoRow | undefined;
    if (!row) return reply.code(404).send({ error: "not found" });
    return { commits: await repoCommits(row) };
  });

  app.get("/:id/tree", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = app.db.prepare("SELECT * FROM repos WHERE id = ?").get(id) as RepoRow | undefined;
    if (!row) return reply.code(404).send({ error: "not found" });
    return { tree: await repoTree(row) };
  });
}
