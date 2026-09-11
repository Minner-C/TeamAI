import type { FastifyInstance } from "fastify";

export async function imRoutes(app: FastifyInstance) {
  app.get("/channels", async () => ({ channels: [] }));

  app.post("/channels", async (_req, reply) => {
    return reply.code(501).send({ error: "channel creation not implemented yet" });
  });

  app.get("/channels/:id/messages", async () => ({ messages: [] }));

  app.get("/ai-roles", async () => ({ roles: [] }));

  app.post("/ai-roles", async (_req, reply) => {
    return reply.code(501).send({ error: "ai role creation not implemented yet" });
  });
}
