import crypto from "node:crypto";
import type { Db } from "../../db.js";
import { randomId } from "../core/crypto.js";
import type { RepoRow } from "./store.js";

export interface WebhookRow {
  id: string;
  repo_id: string;
  url: string;
  secret: string;
  enabled: number;
  created_at: number;
}

export interface PushEventPayload {
  event: "push" | "ping";
  repo: { id: string; group: string; name: string };
  pusher: { name: string; email: string } | null;
  ts: number;
}

export function listWebhooks(db: Db, repoId: string): WebhookRow[] {
  return db
    .prepare("SELECT * FROM repo_webhooks WHERE repo_id = ? ORDER BY created_at ASC")
    .all(repoId) as unknown as WebhookRow[];
}

export function addWebhook(db: Db, repoId: string, url: string, secret?: string): WebhookRow {
  const row: WebhookRow = {
    id: randomId(),
    repo_id: repoId,
    url,
    secret: secret ?? "",
    enabled: 1,
    created_at: Date.now(),
  };
  db.prepare("INSERT INTO repo_webhooks (id, repo_id, url, secret, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)").run(
    row.id,
    row.repo_id,
    row.url,
    row.secret,
    row.created_at,
  );
  return row;
}

export function deleteWebhook(db: Db, repoId: string, webhookId: string): boolean {
  return db.prepare("DELETE FROM repo_webhooks WHERE id = ? AND repo_id = ?").run(webhookId, repoId).changes > 0;
}

async function deliver(hook: WebhookRow, payload: PushEventPayload, log: { warn: (obj: object, msg: string) => void }): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-teamai-event": payload.event,
  };
  if (hook.secret) {
    const sig = crypto.createHmac("sha256", hook.secret).update(body).digest("hex");
    headers["x-teamai-signature"] = `sha256=${sig}`;
  }
  try {
    const res = await fetch(hook.url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) log.warn({ url: hook.url, status: res.status }, "webhook delivery failed");
  } catch (err) {
    log.warn({ url: hook.url, err }, "webhook delivery error");
  }
}

export function fireWebhook(
  db: Db,
  repo: RepoRow,
  event: "push" | "ping",
  pusherId: string | null,
  log: { warn: (obj: object, msg: string) => void },
): void {
  const hooks = listWebhooks(db, repo.id).filter((h) => h.enabled);
  if (hooks.length === 0) return;
  const pusher = pusherId
    ? (db.prepare("SELECT name, email FROM users WHERE id = ?").get(pusherId) as { name: string; email: string } | undefined)
    : undefined;
  const payload: PushEventPayload = {
    event,
    repo: { id: repo.id, group: repo.grp, name: repo.name },
    pusher: pusher ?? null,
    ts: Date.now(),
  };
  for (const hook of hooks) void deliver(hook, payload, log);
}
