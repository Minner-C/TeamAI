import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../core/auth.js";
import { listAudit } from "./store.js";

export async function auditRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: requireAdmin }, async (req) => {
    const q = req.query as { limit?: string; action?: string; userId?: string };
    return {
      logs: listAudit(app.db, {
        limit: q.limit ? Number(q.limit) : undefined,
        action: q.action,
        userId: q.userId,
      }),
    };
  });
}
