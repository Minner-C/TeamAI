import type { FastifyInstance } from "fastify";
import { requireUser } from "../core/auth.js";
import {
  channelMembers,
  createChannel,
  createRole,
  deleteRole,
  insertMessage,
  isMember,
  listMessages,
  listMyChannels,
  listRoles,
  markRead,
  toMessageView,
} from "./store.js";
import { broadcastToChannel } from "./hub.js";
import { triggerRolesForMessage } from "../airole/engine.js";

export async function imRoutes(app: FastifyInstance) {
  app.get("/channels", { preHandler: requireUser }, async (req) => ({
    channels: listMyChannels(app.db, req.user!.id),
  }));

  app.post("/channels", { preHandler: requireUser }, async (req, reply) => {
    const body = req.body as
      | { type?: "dm" | "group"; name?: string; memberIds?: string[] }
      | undefined;
    if (!body?.type || !body.memberIds?.length) {
      return reply.code(400).send({ error: "type and memberIds required" });
    }
    try {
      const ch = createChannel(app.db, {
        type: body.type,
        name: body.name,
        ownerId: req.user!.id,
        memberIds: body.memberIds,
      });
      return reply.code(201).send(ch);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "create failed" });
    }
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
      | { name?: string; personaPrompt?: string; model?: string; trigger?: string }
      | undefined;
    if (!body?.name || !body.model) return reply.code(400).send({ error: "name and model required" });
    const row = createRole(app.db, {
      channelId: id,
      name: body.name,
      personaPrompt: body.personaPrompt ?? "",
      model: body.model,
      trigger: body.trigger,
    });
    return reply.code(201).send(row);
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
