import type { FastifyInstance } from "fastify";
import { requireUser } from "../core/auth.js";
import { queryRecords, queryStats, querySummary } from "./store.js";

export async function usageRoutes(app: FastifyInstance) {
  app.get("/summary", { preHandler: requireUser }, async (req) => {
    const q = req.query as { from?: string; to?: string; userId?: string };
    return querySummary(app.db, {
      from: q.from ? Number(q.from) : undefined,
      to: q.to ? Number(q.to) : undefined,
      userId: req.user!.role === "admin" ? q.userId : req.user!.id,
    });
  });

  app.get("/stats", { preHandler: requireUser }, async (req) => {
    const q = req.query as { from?: string; to?: string; userId?: string };
    return queryStats(app.db, {
      from: q.from ? Number(q.from) : undefined,
      to: q.to ? Number(q.to) : undefined,
      userId: req.user!.role === "admin" ? q.userId : req.user!.id,
    });
  });

  app.get("/records", { preHandler: requireUser }, async (req) => {
    const q = req.query as {
      from?: string;
      to?: string;
      userId?: string;
      model?: string;
      limit?: string;
      offset?: string;
    };
    return {
      records: queryRecords(app.db, {
        from: q.from ? Number(q.from) : undefined,
        to: q.to ? Number(q.to) : undefined,
        userId: req.user!.role === "admin" ? q.userId : req.user!.id,
        model: q.model,
        limit: Math.min(Number(q.limit ?? 50), 200),
        offset: Number(q.offset ?? 0),
      }),
    };
  });
}
