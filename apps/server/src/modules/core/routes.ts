import type { FastifyInstance } from "fastify";

export async function coreRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req, reply) => {
    const body = req.body as { email?: string; password?: string } | undefined;
    if (!body?.email || !body?.password) {
      return reply.code(400).send({ error: "email and password required" });
    }
    return reply.code(501).send({ error: "auth not implemented yet" });
  });

  app.get("/me", async (_req, reply) => {
    return reply.code(501).send({ error: "not implemented yet" });
  });
}
