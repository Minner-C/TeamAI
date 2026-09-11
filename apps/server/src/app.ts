import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "./config.js";
import { openDb } from "./db.js";
import { coreRoutes } from "./modules/core/routes.js";
import { gatewayRoutes } from "./modules/gateway/routes.js";
import { usageRoutes } from "./modules/usage/routes.js";
import { storageRoutes } from "./modules/storage/routes.js";
import { gitRoutes } from "./modules/git/routes.js";
import { gitSmartHttp } from "./modules/git/smartHttp.js";
import { imRoutes } from "./modules/im/routes.js";
import { imWs } from "./modules/im/ws.js";

export async function buildApp(config: ServerConfig) {
  const app = Fastify({ logger: true });

  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (typeof body !== "string" || body.trim() === "") return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      done(err as Error);
    }
  });

  app.decorate("config", config);
  app.decorate("db", openDb(config));

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/health", async () => ({ ok: true, service: "teamai-server", ts: Date.now() }));

  const adminHtml = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/admin.html");
  app.get("/", async (_req, reply) => reply.redirect("/admin"));
  app.get("/admin", async (_req, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(fs.createReadStream(adminHtml));
  });

  await app.register(coreRoutes, { prefix: "/api" });
  await app.register(gatewayRoutes);
  await app.register(usageRoutes, { prefix: "/api/usage" });
  await app.register(storageRoutes, { prefix: "/api" });
  await app.register(gitSmartHttp);
  await app.register(gitRoutes, { prefix: "/api/repos" });
  await app.register(imRoutes, { prefix: "/api" });
  await app.register(imWs);

  app.log.info({ reposDir: config.reposDir }, "repos dir");

  return app;
}
