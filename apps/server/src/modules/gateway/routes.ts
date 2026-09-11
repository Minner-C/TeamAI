import type { FastifyInstance } from "fastify";

export async function gatewayRoutes(app: FastifyInstance) {
  app.post("/v1/chat/completions", async (_req, reply) => {
    return reply.code(501).send({ error: "gateway not implemented yet" });
  });

  app.post("/v1/messages", async (_req, reply) => {
    return reply.code(501).send({ error: "gateway not implemented yet" });
  });

  app.get("/api/admin/providers", async () => ({ providers: [] }));

  app.post("/api/admin/keys", async (_req, reply) => {
    return reply.code(501).send({ error: "virtual key issuance not implemented yet" });
  });
}
