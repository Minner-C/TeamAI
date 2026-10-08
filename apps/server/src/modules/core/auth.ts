import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyToken } from "./crypto.js";
import type { UserRow, VirtualKeyRow } from "../../types.js";
import { startOfMonth, startOfToday, sumUserTokensSince } from "../usage/store.js";

export function checkUserQuota(req: FastifyRequest, reply: FastifyReply, user: UserRow): boolean {
  if (user.quota_daily_tokens != null) {
    const used = sumUserTokensSince(req.server.db, user.id, startOfToday());
    if (used >= user.quota_daily_tokens) {
      reply.code(429).send({
        error: "daily quota exceeded",
        message: `已达到今日用量上限（${used}/${user.quota_daily_tokens} tokens），请联系管理员调整配额`,
      });
      return false;
    }
  }
  if (user.quota_monthly_tokens != null) {
    const used = sumUserTokensSince(req.server.db, user.id, startOfMonth());
    if (used >= user.quota_monthly_tokens) {
      reply.code(429).send({
        error: "monthly quota exceeded",
        message: `已达到本月用量上限（${used}/${user.quota_monthly_tokens} tokens），请联系管理员调整配额`,
      });
      return false;
    }
  }
  return true;
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim();
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const token = bearer(req);
  const payload = token ? verifyToken(token, req.server.config.jwtSecret) : null;
  if (!payload) return reply.code(401).send({ error: "unauthorized" });
  const user = req.server.db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(payload.uid) as UserRow | undefined;
  if (!user) return reply.code(401).send({ error: "unauthorized" });
  req.user = user;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply);
  if (reply.sent) return;
  if (req.user?.role !== "admin") return reply.code(403).send({ error: "admin only" });
}

export async function requireVirtualKey(req: FastifyRequest, reply: FastifyReply) {
  const key = bearer(req);
  if (!key?.startsWith("tk-")) return reply.code(401).send({ error: "virtual key required" });
  return checkVirtualKey(req, reply, key);
}

async function checkVirtualKey(req: FastifyRequest, reply: FastifyReply, key: string) {
  const row = req.server.db
    .prepare("SELECT * FROM virtual_keys WHERE key = ?")
    .get(key) as VirtualKeyRow | undefined;
  if (!row || row.revoked_at) return reply.code(401).send({ error: "invalid or revoked key" });
  if (row.quota_tokens != null) {
    const used = req.server.db
      .prepare("SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS total FROM usage_records WHERE user_id = ?")
      .get(row.user_id) as { total: number };
    if (used.total >= row.quota_tokens) {
      return reply.code(429).send({ error: "quota exceeded" });
    }
  }
  const user = req.server.db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id) as UserRow | undefined;
  if (user && !checkUserQuota(req, reply, user)) return;
  req.virtualKey = row;
}

export async function requireGatewayAuth(req: FastifyRequest, reply: FastifyReply) {
  const key = bearer(req);
  if (key?.startsWith("tk-")) return checkVirtualKey(req, reply, key);
  await requireUser(req, reply);
  if (reply.sent) return;
  if (req.user && !checkUserQuota(req, reply, req.user)) return;
}
