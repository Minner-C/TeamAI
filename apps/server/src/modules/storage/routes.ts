import type { FastifyInstance } from "fastify";

export async function storageRoutes(app: FastifyInstance) {
  app.post("/sessions", async (_req, reply) => {
    return reply.code(501).send({ error: "session archive upload not implemented yet" });
  });

  app.get("/sessions", async () => ({ sessions: [] }));

  app.post("/files", async (_req, reply) => {
    return reply.code(501).send({ error: "file upload not implemented yet" });
  });
}
