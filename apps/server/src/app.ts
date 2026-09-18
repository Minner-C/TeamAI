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
import { envRoutes } from "./modules/envs/routes.js";
import { auditRoutes } from "./modules/audit/routes.js";
import { fileRoutes } from "./modules/files/routes.js";
import { initRunner, reconcileOnBoot } from "./modules/envs/runner.js";

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
  const webIndex = path.join(config.webDir, "index.html");
  const webAvailable = fs.existsSync(webIndex);
  const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json",
    ".txt": "text/plain; charset=utf-8",
  };
  const serveWebIndex = (reply: import("fastify").FastifyReply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(fs.createReadStream(webIndex));
  };
  app.get("/", async (_req, reply) => (webAvailable ? serveWebIndex(reply) : reply.redirect("/admin")));
  app.get("/admin", async (_req, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(fs.createReadStream(adminHtml));
  });
  app.setNotFoundHandler((req, reply) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const reserved =
      urlPath.startsWith("/api/") || urlPath.startsWith("/v1/") ||
      urlPath.startsWith("/git/") || urlPath.startsWith("/ws") ||
      urlPath === "/admin" || urlPath === "/health";
    if (req.method === "GET" && webAvailable && !reserved) {
      const filePath = path.normalize(path.join(config.webDir, urlPath));
      if (filePath.startsWith(config.webDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        reply.type(MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream");
        return reply.send(fs.createReadStream(filePath));
      }
      return serveWebIndex(reply);
    }
    return reply.code(404).send({ error: "not found" });
  });

  await app.register(coreRoutes, { prefix: "/api" });
  await app.register(gatewayRoutes);
  await app.register(usageRoutes, { prefix: "/api/usage" });
  await app.register(storageRoutes, { prefix: "/api" });
  await app.register(gitSmartHttp);
  await app.register(gitRoutes, { prefix: "/api/repos" });
  await app.register(imRoutes, { prefix: "/api" });
  await app.register(imWs);
  await app.register(envRoutes, { prefix: "/api/envs" });
  await app.register(auditRoutes, { prefix: "/api/admin/audit" });
  await app.register(fileRoutes, { prefix: "/api/files" });

  const envBackend = await initRunner(config);
  await reconcileOnBoot(app.db);

  app.log.info({ reposDir: config.reposDir, envBackend }, "repos dir");

  return app;
}
