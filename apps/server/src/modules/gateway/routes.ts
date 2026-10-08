import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import type { ProviderRow } from "../../types.js";
import { findProvidersForModel, providerApiKey } from "./store.js";
import { pickKey, reportKeyFailure, reportKeySuccess, listProviderKeys, toKeyView, addProviderKey, deleteProviderKey, resetProviderKey } from "./keyPool.js";
import { estimateCost, parsePricing } from "./pricing.js";
import { insertUsage } from "../usage/store.js";
import { recordAudit } from "../audit/store.js";
import {
  anthropicResponseToOpenai,
  anthropicToOpenai,
  openaiResponseToAnthropic,
  openaiToAnthropic,
  providerStyle,
  upstreamHeaders,
  upstreamUrl,
  modelsUrl,
  type ApiStyle,
} from "./providers.js";

interface CapturedUsage {
  tokensIn: number;
  tokensOut: number;
  estimated: boolean;
}

function requestMeta(req: FastifyRequest) {
  return {
    userId: req.virtualKey?.user_id ?? req.user!.id,
    cli: (req.headers["x-teamai-cli"] as string) ?? null,
    taskId: (req.headers["x-teamai-task"] as string) ?? null,
  };
}

function estimateUsage(body: Record<string, unknown>): CapturedUsage {
  const messages = (body.messages as Array<{ content?: string }>) ?? [];
  const chars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  return { tokensIn: Math.ceil(chars / 4), tokensOut: 0, estimated: true };
}

function recordUsage(
  app: FastifyInstance,
  req: FastifyRequest,
  provider: ProviderRow,
  model: string,
  usage: CapturedUsage,
) {
  const meta = requestMeta(req);
  insertUsage(app.db, {
    userId: meta.userId,
    model,
    providerId: provider.id,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    estimated: usage.estimated,
    cost: estimateCost(provider, model, usage.tokensIn, usage.tokensOut),
    cli: meta.cli,
    taskId: meta.taskId,
  });
}

async function pipeStream(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  upstream: Response,
  provider: ProviderRow,
  model: string,
  style: ApiStyle,
) {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const usage: CapturedUsage = { tokensIn: 0, tokensOut: 0, estimated: false };
  let buffer = "";
  const body = Readable.fromWeb(upstream.body as import("stream/web").ReadableStream);

  body.on("data", (chunk: Buffer) => {
    reply.raw.write(chunk);
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        if (style === "openai" && json.usage) {
          usage.tokensIn = json.usage.prompt_tokens ?? usage.tokensIn;
          usage.tokensOut = json.usage.completion_tokens ?? usage.tokensOut;
        } else if (style === "anthropic") {
          if (json.type === "message_start" && json.message?.usage) {
            usage.tokensIn = json.message.usage.input_tokens ?? 0;
            usage.tokensOut = json.message.usage.output_tokens ?? 0;
          } else if (json.type === "message_delta" && json.usage) {
            usage.tokensOut = json.usage.output_tokens ?? usage.tokensOut;
          }
        }
      } catch {
        // partial JSON line, ignore
      }
    }
  });

  body.on("end", () => {
    reply.raw.end();
    if (!usage.tokensIn && !usage.tokensOut) {
      const est = estimateUsage(req.body as Record<string, unknown>);
      usage.tokensIn = est.tokensIn;
      usage.estimated = true;
    }
    recordUsage(app, req, provider, model, usage);
  });

  body.on("error", () => {
    reply.raw.end();
  });
}

async function proxyJson(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  upstream: Response,
  provider: ProviderRow,
  model: string,
  style: ApiStyle,
  crossStyle: boolean,
) {
  const json = (await upstream.json()) as Record<string, unknown>;
  if (!upstream.ok) {
    return reply.code(upstream.status).send(json);
  }
  let usage: CapturedUsage;
  let out = json;
  if (style === "openai") {
    const u = (json.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};
    usage = { tokensIn: u.prompt_tokens ?? 0, tokensOut: u.completion_tokens ?? 0, estimated: false };
    if (crossStyle) out = openaiResponseToAnthropic(json);
  } else {
    const u = (json.usage as { input_tokens?: number; output_tokens?: number }) ?? {};
    usage = { tokensIn: u.input_tokens ?? 0, tokensOut: u.output_tokens ?? 0, estimated: false };
    if (crossStyle) out = anthropicResponseToOpenai(json);
  }
  if (!usage.tokensIn && !usage.tokensOut) {
    const est = estimateUsage(req.body as Record<string, unknown>);
    usage.tokensIn = est.tokensIn;
    usage.estimated = true;
  }
  recordUsage(app, req, provider, model, usage);
  return reply.send(out);
}

function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 409 || status === 429 || status >= 500;
}

function sendUpstreamError(
  req: FastifyRequest,
  reply: FastifyReply,
  provider: ProviderRow,
  url: string,
  status: number,
  text: string,
  model: string,
) {
  req.log.warn({ provider: provider.name, url, status }, "upstream rejected request");
  const hint =
    status === 404
      ? `请求地址 ${url} 不存在，请检查管理后台中 provider「${provider.name}」的 baseUrl：OpenAI 兼容接口一般填到域名或 /v1 即可（如 https://api.openai.com 或 https://api.deepseek.com/v1），不要包含 /chat/completions 之后的部分；同时确认模型名「${model}」在该平台可用`
      : status === 401 || status === 403
        ? `provider「${provider.name}」的 API Key 无效或没有权限，请到管理后台检查`
        : "";
  return reply.code(status).send({
    error: "upstream error",
    detail: text || hint,
    provider: provider.name,
    url,
  });
}

const MAX_ATTEMPTS = 6;

async function handle(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  requestStyle: ApiStyle,
) {
  const body = req.body as Record<string, unknown> | undefined;
  const model = body?.model as string | undefined;
  if (!body || !model) return reply.code(400).send({ error: "model required" });

  const candidates = findProvidersForModel(
    app.db,
    model,
    requestStyle === "anthropic" ? "anthropic" : "openai-compatible",
  );
  if (candidates.length === 0) return reply.code(404).send({ error: `no enabled provider for model: ${model}` });

  let attempts = 0;
  let upstream: Response | null = null;
  let provider: ProviderRow | null = null;
  let lastFailure: { status: number; text: string; provider: ProviderRow; url: string } | null = null;
  let sawCoolingOnly = false;

  outer: for (const candidate of candidates) {
    const style = providerStyle(candidate);
    const crossStyle = style !== requestStyle;
    const wantStream = body.stream === true && !crossStyle;
    const upstreamBody = crossStyle
      ? requestStyle === "openai"
        ? openaiToAnthropic(body)
        : anthropicToOpenai(body)
      : requestStyle === "openai" && wantStream
        ? { ...body, stream_options: { include_usage: true } }
        : body;
    const url = upstreamUrl(candidate, style);

    const exclude = new Set<string>();
    while (attempts < MAX_ATTEMPTS) {
      const picked = pickKey(app.db, app.config.jwtSecret, candidate.id, exclude);
      if (!picked) {
        if (exclude.size > 0 || candidates.length === 1) sawCoolingOnly = true;
        break;
      }
      exclude.add(picked.id);
      attempts++;

      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: upstreamHeaders(candidate, picked.apiKey),
          body: JSON.stringify(upstreamBody),
        });
      } catch (err) {
        reportKeyFailure(app.db, picked.id);
        req.log.warn({ provider: candidate.name, url, err }, "upstream fetch failed, trying next key");
        lastFailure = { status: 502, text: "upstream unreachable", provider: candidate, url };
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        if (isRetryableStatus(res.status)) {
          reportKeyFailure(app.db, picked.id);
          req.log.warn(
            { provider: candidate.name, key: picked.label || picked.id, url, status: res.status },
            "upstream key rejected, trying next key",
          );
          lastFailure = { status: res.status, text, provider: candidate, url };
          continue;
        }
        return sendUpstreamError(req, reply, candidate, url, res.status, text, model);
      }

      reportKeySuccess(app.db, picked.id);
      upstream = res;
      provider = candidate;
      break outer;
    }
  }

  if (!upstream || !provider) {
    if (lastFailure) {
      return sendUpstreamError(req, reply, lastFailure.provider, lastFailure.url, lastFailure.status, lastFailure.text, model);
    }
    return reply.code(503).send({
      error: "no available upstream key",
      detail: sawCoolingOnly ? "所有上游 Key 均在熔断冷却中，请稍后重试或在管理后台检查 Key 状态" : "provider 未配置可用 Key",
    });
  }

  const style = providerStyle(provider);
  const crossStyle = style !== requestStyle;
  const wantStream = body.stream === true && !crossStyle;
  if (wantStream) {
    return pipeStream(app, req, reply, upstream, provider, model, style);
  }
  return proxyJson(app, req, reply, upstream, provider, model, style, crossStyle);
}

import { requireAdmin, requireUser, requireGatewayAuth } from "../core/auth.js";
import * as store from "./store.js";
import type { VirtualKeyRow } from "../../types.js";

export async function gatewayRoutes(app: FastifyInstance) {

  app.post("/v1/chat/completions", { preHandler: requireGatewayAuth }, (req, reply) =>
    handle(app, req, reply, "openai"),
  );

  app.post("/v1/messages", { preHandler: requireGatewayAuth }, (req, reply) =>
    handle(app, req, reply, "anthropic"),
  );

  app.get("/api/models", { preHandler: requireUser }, async () => {
    const providers = store.listProviders(app.db).filter((p) => p.enabled);
    return {
      models: providers.flatMap((p) =>
        (JSON.parse(p.models_json) as string[]).map((m) => ({
          model: m,
          providerId: p.id,
          providerType: p.type,
        })),
      ),
    };
  });

  app.get("/api/admin/providers", { preHandler: requireAdmin }, async () => ({
    providers: store.listProviders(app.db).map((p) => store.toProviderView(p, app.db)),
  }));

  app.post("/api/admin/providers", { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as
      | { name?: string; type?: string; baseUrl?: string; apiKey?: string; models?: string[] }
      | undefined;
    if (!body?.name || !body.type || !body.baseUrl || !body.apiKey) {
      return reply.code(400).send({ error: "name, type, baseUrl, apiKey required" });
    }
    const view = store.createProvider(app.db, app.config.jwtSecret, {
      name: body.name,
      type: body.type,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      models: body.models ?? [],
    });
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "provider.create",
      target: body.name,
      detail: `${body.type} ${body.baseUrl} models=${(body.models ?? []).join(",")}`,
      ip: req.ip,
    });
    return view;
  });

  app.patch("/api/admin/providers/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as
      | { enabled?: boolean; models?: string[]; name?: string; type?: string; baseUrl?: string; apiKey?: string; pricing?: Record<string, { in: number; out: number }> }
      | undefined;
    const hasProfile = !!(body?.name?.trim() || body?.type?.trim() || body?.baseUrl?.trim() || body?.apiKey || body?.pricing);
    if (!body || (body.enabled == null && !body.models && !hasProfile)) {
      return reply.code(400).send({ error: "enabled, models or profile fields required" });
    }
    if (body.pricing && Object.keys(parsePricing(JSON.stringify(body.pricing))).length !== Object.keys(body.pricing).length) {
      return reply.code(400).send({ error: "pricing 格式应为 { 模型名: { in: 每百万输入token美元价, out: 每百万输出token美元价 } }" });
    }
    const row = app.db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | undefined;
    if (!row) return reply.code(404).send({ error: "provider not found" });
    const view = store.updateProvider(app.db, app.config.jwtSecret, id, {
      name: body.name,
      type: body.type,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      models: body.models,
      pricing: body.pricing,
    });
    if (body.enabled != null) store.setProviderEnabled(app.db, id, body.enabled);
    const changes = [
      body.name?.trim() && body.name.trim() !== row.name ? `name=${body.name.trim()}` : "",
      body.type?.trim() && body.type.trim() !== row.type ? `type=${body.type.trim()}` : "",
      body.baseUrl?.trim() && body.baseUrl.trim() !== row.base_url ? `baseUrl=${body.baseUrl.trim()}` : "",
      body.apiKey ? "apiKey=已更新" : "",
      body.models ? `models=${body.models.join(",")}` : "",
      body.enabled != null ? `enabled=${body.enabled ? 1 : 0}` : "",
    ].filter(Boolean);
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: hasProfile ? "provider.update" : body.models ? "provider.update_models" : body.enabled ? "provider.enable" : "provider.disable",
      target: body.name?.trim() || row.name,
      detail: changes.join(" ") || undefined,
      ip: req.ip,
    });
    const finalRow = app.db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as unknown as ProviderRow;
    return store.toProviderView(finalRow, app.db) ?? view;
  });

  app.post("/api/admin/providers/:id/test", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = app.db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | undefined;
    if (!row) return reply.code(404).send({ error: "provider not found" });
    const url = modelsUrl(row);
    const picked = pickKey(app.db, app.config.jwtSecret, row.id, new Set());
    const apiKey = picked?.apiKey ?? providerApiKey(row, app.config.jwtSecret);
    const started = Date.now();
    try {
      const res = await fetch(url, {
        headers: upstreamHeaders(row, apiKey),
        signal: AbortSignal.timeout(8000),
      });
      const latencyMs = Date.now() - started;
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, status: res.status, latencyMs, error: text.slice(0, 300) };
      }
      let models: string[] = [];
      try {
        const data = JSON.parse(text) as { data?: Array<{ id: string }> };
        models = (data.data ?? []).map((m) => m.id).filter(Boolean);
      } catch {
        // 非 JSON 响应视为连通但无模型列表
      }
      return { ok: true, status: res.status, latencyMs, models };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  app.delete("/api/admin/providers/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.deleteProvider(app.db, id)) return reply.code(404).send({ error: "not found" });
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "provider.delete",
      target: id,
      ip: req.ip,
    });
    return { ok: true };
  });

  app.get("/api/admin/providers/:id/keys", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = app.db.prepare("SELECT id FROM providers WHERE id = ?").get(id);
    if (!row) return reply.code(404).send({ error: "provider not found" });
    return { keys: listProviderKeys(app.db, id).map((k) => toKeyView(k, app.config.jwtSecret)) };
  });

  app.post("/api/admin/providers/:id/keys", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { apiKey?: string; label?: string } | undefined;
    if (!body?.apiKey) return reply.code(400).send({ error: "apiKey required" });
    const row = app.db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | undefined;
    if (!row) return reply.code(404).send({ error: "provider not found" });
    const key = addProviderKey(app.db, app.config.jwtSecret, id, body.apiKey, body.label);
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "provider.key_add",
      target: row.name,
      detail: body.label?.trim() || undefined,
      ip: req.ip,
    });
    return reply.code(201).send(toKeyView(key, app.config.jwtSecret));
  });

  app.delete("/api/admin/providers/:id/keys/:keyId", { preHandler: requireAdmin }, async (req, reply) => {
    const { keyId } = req.params as { id: string; keyId: string };
    const result = deleteProviderKey(app.db, keyId);
    if (result === "not-found") return reply.code(404).send({ error: "key not found" });
    if (result === "last-key") return reply.code(400).send({ error: "provider 至少保留一个 Key" });
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "provider.key_remove",
      target: keyId,
      ip: req.ip,
    });
    return { ok: true };
  });

  app.post("/api/admin/providers/:id/keys/:keyId/reset", { preHandler: requireAdmin }, async (req, reply) => {
    const { keyId } = req.params as { id: string; keyId: string };
    if (!resetProviderKey(app.db, keyId)) return reply.code(404).send({ error: "key not found" });
    return { ok: true };
  });

  app.get("/api/admin/keys", { preHandler: requireAdmin }, async () => ({
    keys: store.listVirtualKeys(app.db),
  }));

  app.post("/api/keys", { preHandler: requireUser }, async (req, reply) => {
    const body = req.body as { name?: string; quotaTokens?: number } | undefined;
    const row = store.createVirtualKey(app.db, {
      userId: req.user!.id,
      name: body?.name,
      quotaTokens: body?.quotaTokens ?? null,
    });
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "key.create",
      target: body?.name ?? "",
      detail: body?.quotaTokens != null ? `quota=${body.quotaTokens}` : "no-quota",
      ip: req.ip,
    });
    return reply.code(201).send(row);
  });

  app.get("/api/keys", { preHandler: requireUser }, async (req) => ({
    keys: store.listVirtualKeys(app.db, req.user!.id),
  }));

  app.delete("/api/keys/:id", { preHandler: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = app.db.prepare("SELECT * FROM virtual_keys WHERE id = ?").get(id) as
      | VirtualKeyRow
      | undefined;
    if (!row || (row.user_id !== req.user!.id && req.user!.role !== "admin")) {
      return reply.code(404).send({ error: "not found" });
    }
    store.revokeVirtualKey(app.db, id);
    recordAudit(app.db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: "key.revoke",
      target: row.name || id,
      ip: req.ip,
    });
    return { ok: true };
  });
}
