import type { FastifyInstance } from "fastify";
import type { UsageSummary } from "@teamai/shared";

export async function usageRoutes(app: FastifyInstance) {
  app.get("/summary", async (): Promise<UsageSummary> => ({
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCost: 0,
    byModel: {},
    byUser: {},
  }));

  app.get("/records", async () => ({ records: [] }));
}
