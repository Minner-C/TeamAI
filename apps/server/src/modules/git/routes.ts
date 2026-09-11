import type { FastifyInstance } from "fastify";

export async function gitRoutes(app: FastifyInstance) {
  app.get("/", async () => ({ repos: [] }));

  app.post("/", async (_req, reply) => {
    return reply.code(501).send({ error: "repo creation not implemented yet" });
  });

  app.get("/:id/tree", async (_req, reply) => {
    return reply.code(501).send({ error: "repo tree not implemented yet" });
  });
}
