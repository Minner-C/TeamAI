import type { FastifyInstance } from "fastify";
import { requireUser } from "../core/auth.js";
import {
  addChannelMembers,
  channelMembers,
  createChannel,
  createRole,
  deleteRole,
  insertMessage,
  isMember,
  listChannelFiles,
  listMessages,
  listMyChannels,
  listRoles,
  markRead,
  removeChannelMember,
  toMessageView,
  updateChannel,
  updateRole,
} from "./store.js";
import { broadcastToChannel } from "./hub.js";
import { triggerRolesForMessage } from "../airole/engine.js";

export async function imRoutes(app: FastifyInstance) {
  app.get("/channels", { preHandler: requireUser }, async (req) => ({
    channels: listMyChannels(app.db, req.user!.id),
  }));

  app.post("/channels", { preHandler: requireUser }, async (req, reply) => {
    const body = req.body as
      | { type?: "dm" | "group"; name?: string; topic?: string; memberIds?: string[] }
      | undefined;
    if (!body?.type || !body.memberIds?.length) {
      return reply.code(400).send({ error: "type and memberIds required" });
    }
    try {
      const ch = createChannel(app.db, {
        type: body.type,
        name: body.name,
        topic: body.topic,
        ownerId: req.user!.id,
        memberIds: body.memberIds,
      });
      return reply.code(201).send(ch);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "create failed" });
    }
  });

  app.patch("/channels/:id", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isMember(app.db, id, req.user!.id)) return reply.code(403).send({ error: "not a member" });
    const body = req.body as { name?: string; topic?: string } | undefined;
    if (!updateChannel(app.db, id, { name: body?.name, topic: body?.topic })) {
      return reply.code(400).send({ error: "nothing to update" });
    }
    return app.db.prepare("SELECT id, type, name, topic, owner_id, created_at FROM channels WHERE id = ?").get(id);
  });

  app.post("/channels/:id/members", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isMember(app.db, id, req.user!.id)) return reply.code(403).send({ error: "not a member" });
    const body = req.body as { memberIds?: string[] } | undefined;
    if (!body?.memberIds?.length) return reply.code(400).send({ error: "memberIds required" });
    addChannelMembers(app.db, id, body.memberIds);
    return { ok: true };
  });

  app.delete("/channels/:id/members/:uid", { preHandler: requireUser }, async (req, reply) => {
    const { id, uid } = req.params as { id: string; uid: string };
    const ch = app.db.prepare("SELECT owner_id, type FROM channels WHERE id = ?").get(id) as
      | { owner_id: string; type: string }
      | undefined;
    if (!ch) return reply.code(404).send({ error: "not found" });
    if (ch.type !== "group") return reply.code(400).send({ error: "only group channels support member removal" });
    if (req.user!.id !== ch.owner_id && req.user!.id !== uid && req.user!.role !== "admin") {
      return reply.code(403).send({ error: "只有群主或管理员可以移除成员" });
    }
    if (uid === ch.owner_id) return reply.code(400).send({ error: "不能移除群主" });
    if (!removeChannelMember(app.db, id, uid)) return reply.code(404).send({ error: "member not found" });
    return { ok: true };
  });

  app.get("/channels/:id/files", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isMember(app.db, id, req.user!.id)) return reply.code(403).send({ error: "not a member" });
    return { files: listChannelFiles(app.db, id) };
  });

  app.get("/channels/:id/messages", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isMember(app.db, id, req.user!.id)) return reply.code(403).send({ error: "not a member" });
    const q = req.query as { before?: string; limit?: string };
    const rows = listMessages(app.db, id, {
      before: q.before ? Number(q.before) : undefined,
      limit: Math.min(Number(q.limit ?? 50), 200),
    });
    return { messages: rows.map((r) => toMessageView(app.db, r)) };
  });

  app.post("/channels/:id/messages", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isMember(app.db, id, req.user!.id)) return reply.code(403).send({ error: "not a member" });
    const body = req.body as
      | { type?: string; content?: string; payload?: Record<string, unknown> }
      | undefined;
    if (!body?.content?.trim()) return reply.code(400).send({ error: "content required" });
    const row = insertMessage(app.db, {
      channelId: id,
      senderUserId: req.user!.id,
      type: body.type ?? "text",
      content: body.content,
      payload: body.payload,
    });
    const view = toMessageView(app.db, row);
    broadcastToChannel(app.db, id, { type: "message:new", message: view });
    setImmediate(() => void triggerRolesForMessage(app, row.id));
    return reply.code(201).send(view);
  });

  app.post("/channels/:id/read", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isMember(app.db, id, req.user!.id)) return reply.code(403).send({ error: "not a member" });
    markRead(app.db, id, req.user!.id);
    return { ok: true };
  });

  app.get("/channels/:id/roles", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isMember(app.db, id, req.user!.id)) return reply.code(403).send({ error: "not a member" });
    return { roles: listRoles(app.db, id) };
  });

  app.post("/channels/:id/roles", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isMember(app.db, id, req.user!.id)) return reply.code(403).send({ error: "not a member" });
    const body = req.body as
      | { name?: string; personaPrompt?: string; model?: string; trigger?: string; keywords?: string[] }
      | undefined;
    if (!body?.name || !body.model) return reply.code(400).send({ error: "name and model required" });
    const trigger = body.trigger ?? "mention";
    if (!["mention", "keyword", "auto"].includes(trigger)) {
      return reply.code(400).send({ error: "trigger must be mention, keyword or auto" });
    }
    const keywords = (body.keywords ?? []).map((k) => k.trim()).filter(Boolean);
    if (trigger === "keyword" && !keywords.length) {
      return reply.code(400).send({ error: "keyword trigger requires at least one keyword" });
    }
    const row = createRole(app.db, {
      channelId: id,
      name: body.name,
      personaPrompt: body.personaPrompt ?? "",
      model: body.model,
      trigger,
      keywords,
    });
    return reply.code(201).send(row);
  });

  app.patch("/roles/:roleId", { preHandler: requireUser }, async (req, reply) => {
    const { roleId } = req.params as { roleId: string };
    const role = app.db.prepare("SELECT * FROM ai_roles WHERE id = ?").get(roleId) as
      | { id: string; channel_id: string }
      | undefined;
    if (!role) return reply.code(404).send({ error: "not found" });
    if (!isMember(app.db, role.channel_id, req.user!.id)) {
      return reply.code(403).send({ error: "not a member" });
    }
    const body = req.body as
      | { name?: string; personaPrompt?: string; model?: string; trigger?: string; keywords?: string[]; enabled?: boolean }
      | undefined;
    if (body?.trigger !== undefined && !["mention", "keyword", "auto"].includes(body.trigger)) {
      return reply.code(400).send({ error: "trigger must be mention, keyword or auto" });
    }
    const patch = {
      name: body?.name,
      personaPrompt: body?.personaPrompt,
      model: body?.model,
      trigger: body?.trigger,
      keywords: body?.keywords?.map((k) => k.trim()).filter(Boolean),
      enabled: body?.enabled,
    };
    if (!updateRole(app.db, roleId, patch)) return reply.code(400).send({ error: "nothing to update" });
    return app.db.prepare("SELECT * FROM ai_roles WHERE id = ?").get(roleId);
  });

  app.delete("/roles/:roleId", { preHandler: requireUser }, async (req, reply) => {
    const { roleId } = req.params as { roleId: string };
    if (!deleteRole(app.db, roleId)) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  app.get("/channels/:id/members", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isMember(app.db, id, req.user!.id)) return reply.code(403).send({ error: "not a member" });
    const ids = channelMembers(app.db, id);
    const users = ids.map((uid) => {
      const u = app.db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(uid) as
        | { id: string; name: string; email: string }
        | undefined;
      return u ?? { id: uid, name: "?", email: "" };
    });
    return { members: users };
  });
}
