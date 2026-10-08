import type { Db } from "../../db.js";
import type { ProviderKeyRow } from "../../types.js";
import { decryptText, encryptText, randomId } from "../core/crypto.js";

export interface PickedKey {
  id: string;
  apiKey: string;
  label: string;
}

export interface ProviderKeyView {
  id: string;
  label: string;
  preview: string;
  failCount: number;
  cooldownUntil: number | null;
  lastUsedAt: number | null;
  createdAt: number;
}

const FAILURE_THRESHOLD = 3;
const BASE_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 10 * 60_000;

export function listProviderKeys(db: Db, providerId: string): ProviderKeyRow[] {
  return db
    .prepare("SELECT * FROM provider_keys WHERE provider_id = ? ORDER BY created_at ASC")
    .all(providerId) as unknown as ProviderKeyRow[];
}

export function toKeyView(row: ProviderKeyRow, secret: string): ProviderKeyView {
  let preview = "****";
  try {
    const plain = decryptText(row.key_enc, secret);
    preview = plain.length <= 8 ? "****" : `${plain.slice(0, 4)}...${plain.slice(-4)}`;
  } catch {
    // 解密失败不阻断列表展示
  }
  return {
    id: row.id,
    label: row.label,
    preview,
    failCount: row.fail_count,
    cooldownUntil: row.cooldown_until,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

export function addProviderKey(db: Db, secret: string, providerId: string, apiKey: string, label?: string): ProviderKeyRow {
  const row: ProviderKeyRow = {
    id: randomId(),
    provider_id: providerId,
    label: label?.trim() || "",
    key_enc: encryptText(apiKey, secret),
    fail_count: 0,
    cooldown_until: null,
    last_used_at: null,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO provider_keys (id, provider_id, label, key_enc, fail_count, cooldown_until, last_used_at, created_at) VALUES (?, ?, ?, ?, 0, NULL, NULL, ?)",
  ).run(row.id, row.provider_id, row.label, row.key_enc, row.created_at);
  return row;
}

export function deleteProviderKey(db: Db, keyId: string): "ok" | "not-found" | "last-key" {
  const row = db.prepare("SELECT * FROM provider_keys WHERE id = ?").get(keyId) as unknown as ProviderKeyRow | undefined;
  if (!row) return "not-found";
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM provider_keys WHERE provider_id = ?").get(row.provider_id) as unknown as { n: number };
  if (n <= 1) return "last-key";
  db.prepare("DELETE FROM provider_keys WHERE id = ?").run(keyId);
  return "ok";
}

export function resetProviderKey(db: Db, keyId: string): boolean {
  return db.prepare("UPDATE provider_keys SET fail_count = 0, cooldown_until = NULL WHERE id = ?").run(keyId).changes > 0;
}

export function pickKey(db: Db, secret: string, providerId: string, excludeIds: Set<string>): PickedKey | null {
  const now = Date.now();
  const rows = listProviderKeys(db, providerId).filter((r) => !excludeIds.has(r.id));
  const available = rows
    .filter((r) => r.cooldown_until == null || r.cooldown_until <= now)
    .sort((a, b) => (a.last_used_at ?? 0) - (b.last_used_at ?? 0));
  const chosen = available[0] ?? null;
  if (!chosen) return null;
  return { id: chosen.id, apiKey: decryptText(chosen.key_enc, secret), label: chosen.label };
}

export function reportKeySuccess(db: Db, keyId: string): void {
  db.prepare("UPDATE provider_keys SET fail_count = 0, cooldown_until = NULL, last_used_at = ? WHERE id = ?").run(Date.now(), keyId);
}

export function reportKeyFailure(db: Db, keyId: string): void {
  const row = db.prepare("SELECT fail_count FROM provider_keys WHERE id = ?").get(keyId) as unknown as { fail_count: number } | undefined;
  if (!row) return;
  const failCount = row.fail_count + 1;
  let cooldownUntil: number | null = null;
  if (failCount >= FAILURE_THRESHOLD) {
    const backoff = Math.min(BASE_COOLDOWN_MS * 2 ** (failCount - FAILURE_THRESHOLD), MAX_COOLDOWN_MS);
    cooldownUntil = Date.now() + backoff;
  }
  db.prepare("UPDATE provider_keys SET fail_count = ?, cooldown_until = ?, last_used_at = ? WHERE id = ?").run(
    failCount,
    cooldownUntil,
    Date.now(),
    keyId,
  );
}
