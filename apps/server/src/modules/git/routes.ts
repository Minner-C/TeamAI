import type { FastifyInstance } from "fastify";
import { requireUser } from "../core/auth.js";
import {
  addRepoMember,
  canAccessRepo,
  canManageRepo,
  createRepo,
  deleteRepo,
  listRepoMembers,
  listRepos,
  removeRepoMember,
  repoCommits,
  repoTree,
  setRepoVisibility,
  type RepoRow,
} from "./store.js";
import { recordAudit } from "../audit/store.js";
import type { UserRow } from "../../types.js";

function toView(db: import("../../db.js").Db, r: RepoRow) {
  return {
    id: r.id,
    name: r.name,
    group: r.grp,
    ownerId: r.owner_id,
    visibility: r.visibility,
    memberCount: listRepoMembers(db, r.id).length,
    createdAt: r.created_at,
  };
}

function getRepo(app: FastifyInstance, id: string): RepoRow | undefined {
  return app.db.prepare("SELECT * FROM repos WHERE id = ?").get(id) as RepoRow | undefined;
}

export async function gitRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: requireUser }, async (req) => {
    const user = req.user as UserRow;
    return { repos: listRepos(app.db, user.id, user.role === "admin").map((r) => toView(app.db, r)) };
  });

  app.post("/", { preHandler: requireUser }, async (req, reply) => {
    const body = req.body as { name?: string; group?: string; visibility?: string } | undefined;
    if (!body?.name) return reply.code(400).send({ error: "name required" });
    try {
      const row = await createRepo(app.db, app.config.reposDir, {
        name: body.name,
        grp: body.group ?? "default",
        ownerId: (req.user as UserRow).id,
        visibility: body.visibility,
      });
      recordAudit(app.db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        action: "repo.create",
        target: `${body.group ?? "default"}/${body.name}`,
        detail: row.visibility === "private" ? "私有仓库" : "",
        ip: req.ip,
      });
      return reply.code(201).send(toView(app.db, row));
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "create failed" });
    }
  });

  app.delete("/:id", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getRepo(app, id);
    if (!row) return reply.code(404).send({ error: "not found" });
    const user = req.user as UserRow;
    if (!canManageRepo(row, user.id, user.role === "admin")) {
      return reply.code(403).send({ error: "only owner or admin can delete" });
    }
    await deleteRepo(app.db, id);
    recordAudit(app.db, {
      userId: user.id,
      userEmail: user.email,
      action: "repo.delete",
      target: `${row.grp}/${row.name}`,
      ip: req.ip,
    });
    return { ok: true };
  });

  app.get("/:id/commits", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getRepo(app, id);
    if (!row) return reply.code(404).send({ error: "not found" });
    const user = req.user as UserRow;
    if (!canAccessRepo(app.db, row, user.id, user.role === "admin")) {
      return reply.code(403).send({ error: "no access to this repo" });
    }
    return { commits: await repoCommits(row) };
  });

  app.get("/:id/tree", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getRepo(app, id);
    if (!row) return reply.code(404).send({ error: "not found" });
    const user = req.user as UserRow;
    if (!canAccessRepo(app.db, row, user.id, user.role === "admin")) {
      return reply.code(403).send({ error: "no access to this repo" });
    }
    return { tree: await repoTree(row) };
  });

  app.patch("/:id/visibility", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getRepo(app, id);
    if (!row) return reply.code(404).send({ error: "not found" });
    const user = req.user as UserRow;
    if (!canManageRepo(row, user.id, user.role === "admin")) {
      return reply.code(403).send({ error: "only owner or admin can change visibility" });
    }
    const body = req.body as { visibility?: string } | undefined;
    if (body?.visibility !== "team" && body?.visibility !== "private") {
      return reply.code(400).send({ error: "visibility must be team or private" });
    }
    setRepoVisibility(app.db, id, body.visibility);
    recordAudit(app.db, {
      userId: user.id,
      userEmail: user.email,
      action: "repo.visibility",
      target: `${row.grp}/${row.name}`,
      detail: body.visibility === "private" ? "设为私有" : "设为团队可见",
      ip: req.ip,
    });
    return { ok: true, visibility: body.visibility };
  });

  app.get("/:id/members", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getRepo(app, id);
    if (!row) return reply.code(404).send({ error: "not found" });
    const user = req.user as UserRow;
    if (!canAccessRepo(app.db, row, user.id, user.role === "admin")) {
      return reply.code(403).send({ error: "no access to this repo" });
    }
    const members = listRepoMembers(app.db, id).map((m) => {
      const u = app.db.prepare("SELECT name, email FROM users WHERE id = ?").get(m.user_id) as
        | { name: string; email: string }
        | undefined;
      return { userId: m.user_id, role: m.role, name: u?.name ?? "?", email: u?.email ?? "" };
    });
    return { members };
  });

  app.post("/:id/members", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getRepo(app, id);
    if (!row) return reply.code(404).send({ error: "not found" });
    const user = req.user as UserRow;
    if (!canManageRepo(row, user.id, user.role === "admin")) {
      return reply.code(403).send({ error: "only owner or admin can manage members" });
    }
    const body = req.body as { userId?: string } | undefined;
    if (!body?.userId) return reply.code(400).send({ error: "userId required" });
    const target = app.db.prepare("SELECT id, name FROM users WHERE id = ?").get(body.userId) as
      | { id: string; name: string }
      | undefined;
    if (!target) return reply.code(404).send({ error: "user not found" });
    addRepoMember(app.db, id, body.userId);
    recordAudit(app.db, {
      userId: user.id,
      userEmail: user.email,
      action: "repo.member_add",
      target: `${row.grp}/${row.name}`,
      detail: target.name,
      ip: req.ip,
    });
    return { ok: true };
  });

  app.delete("/:id/members/:userId", { preHandler: requireUser }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const row = getRepo(app, id);
    if (!row) return reply.code(404).send({ error: "not found" });
    const user = req.user as UserRow;
    if (!canManageRepo(row, user.id, user.role === "admin")) {
      return reply.code(403).send({ error: "only owner or admin can manage members" });
    }
    if (!removeRepoMember(app.db, id, userId)) {
      return reply.code(400).send({ error: "member not found or is owner" });
    }
    recordAudit(app.db, {
      userId: user.id,
      userEmail: user.email,
      action: "repo.member_remove",
      target: `${row.grp}/${row.name}`,
      detail: userId,
      ip: req.ip,
    });
    return { ok: true };
  });
}
