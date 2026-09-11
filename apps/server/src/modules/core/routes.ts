import type { FastifyInstance } from "fastify";
import { verifyPassword, signToken } from "./crypto.js";
import { requireUser } from "./auth.js";
import type { UserRow } from "../../types.js";

const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

export async function coreRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req, reply) => {
    const body = req.body as { email?: string; password?: string } | undefined;
    if (!body?.email || !body?.password) {
      return reply.code(400).send({ error: "email and password required" });
    }
    const user = app.db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(body.email) as UserRow | undefined;
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    const token = signToken({ uid: user.id, exp: Date.now() + TOKEN_TTL_MS }, app.config.jwtSecret);
    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  });

  app.get("/me", { preHandler: requireUser }, async (req) => {
    const u = req.user!;
    return { id: u.id, name: u.name, email: u.email, role: u.role };
  });
}
