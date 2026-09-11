import type { Db } from "../../db.js";
import type { ProviderRow, VirtualKeyRow } from "../../types.js";
import { decryptText, encryptText, generateVirtualKey, randomId } from "../core/crypto.js";

export interface ProviderView {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  models: string[];
  enabled: boolean;
  createdAt: number;
}

export function toProviderView(row: ProviderRow): ProviderView {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl: row.base_url,
    models: JSON.parse(row.models_json) as string[],
    enabled: !!row.enabled,
    createdAt: row.created_at,
  };
}

export function listProviders(db: Db): ProviderRow[] {
  return db.prepare("SELECT * FROM providers ORDER BY created_at DESC").all() as unknown as ProviderRow[];
}

export function createProvider(
  db: Db,
  secret: string,
  input: { name: string; type: string; baseUrl: string; apiKey: string; models: string[] },
): ProviderView {
  const row: ProviderRow = {
    id: randomId(),
    name: input.name,
    type: input.type,
    base_url: input.baseUrl,
    key_enc: encryptText(input.apiKey, secret),
    models_json: JSON.stringify(input.models),
    enabled: 1,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO providers (id, name, type, base_url, key_enc, models_json, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.name, row.type, row.base_url, row.key_enc, row.models_json, row.enabled, row.created_at);
  return toProviderView(row);
}

export function setProviderEnabled(db: Db, id: string, enabled: boolean): boolean {
  const r = db.prepare("UPDATE providers SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  return r.changes > 0;
}

export function deleteProvider(db: Db, id: string): boolean {
  return db.prepare("DELETE FROM providers WHERE id = ?").run(id).changes > 0;
}

export function findProviderForModel(db: Db, model: string, preferType?: string): ProviderRow | null {
  const rows = db
    .prepare("SELECT * FROM providers WHERE enabled = 1 ORDER BY created_at ASC")
    .all() as unknown as ProviderRow[];
  const match = (r: ProviderRow) => {
    const models = JSON.parse(r.models_json) as string[];
    return models.length === 0 || models.includes(model);
  };
  if (preferType) {
    const exact = rows.find((r) => r.type === preferType && match(r));
    if (exact) return exact;
  }
  return rows.find(match) ?? null;
}

export function providerApiKey(row: ProviderRow, secret: string): string {
  return decryptText(row.key_enc, secret);
}

export function createVirtualKey(
  db: Db,
  input: { userId: string; name?: string; quotaTokens?: number | null },
): VirtualKeyRow {
  const row: VirtualKeyRow = {
    id: randomId(),
    key: generateVirtualKey(),
    user_id: input.userId,
    name: input.name ?? "",
    quota_tokens: input.quotaTokens ?? null,
    revoked_at: null,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO virtual_keys (id, key, user_id, name, quota_tokens, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
  ).run(row.id, row.key, row.user_id, row.name, row.quota_tokens, row.created_at);
  return row;
}

export function listVirtualKeys(db: Db, userId?: string): VirtualKeyRow[] {
  if (userId) {
    return db
      .prepare("SELECT * FROM virtual_keys WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as unknown as VirtualKeyRow[];
  }
  return db.prepare("SELECT * FROM virtual_keys ORDER BY created_at DESC").all() as unknown as VirtualKeyRow[];
}

export function revokeVirtualKey(db: Db, id: string): boolean {
  return db
    .prepare("UPDATE virtual_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(Date.now(), id).changes > 0;
}
