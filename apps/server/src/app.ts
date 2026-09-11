import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { ServerConfig } from "./config.js";
import { openDb } from "./db.js";
import { coreRoutes } from "./modules/core/routes.js";
import { gatewayRoutes } from "./modules/gateway/routes.js";
import { usageRoutes } from "./modules/usage/routes.js";
import { storageRoutes } from "./modules/storage/routes.js";
import { gitRoutes } from "./modules/git/routes.js";
import { imRoutes } from "./modules/im/routes.js";
import { imWs } from "./modules/im/ws.js";

export async function buildApp(config: ServerConfig) {
  const app = Fastify({ logger: true });

  app.decorate("config", config);
  app.decorate("db", openDb(config));

  await app.register(websocket);

  app.get("/health", async () => ({ ok: true, service: "teamai-server", ts: Date.now() }));

  await app.register(coreRoutes, { prefix: "/api" });
  await app.register(gatewayRoutes);
  await app.register(usageRoutes, { prefix: "/api/usage" });
  await app.register(storageRoutes, { prefix: "/api" });
  await app.register(gitRoutes, { prefix: "/api/repos" });
  await app.register(imRoutes, { prefix: "/api" });
  await app.register(imWs);

  app.log.info({ reposDir: config.reposDir }, "repos dir");

  return app;
}
