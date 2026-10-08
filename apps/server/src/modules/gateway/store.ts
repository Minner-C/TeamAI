import type { Db } from "../../db.js";
import type { ProviderRow, VirtualKeyRow } from "../../types.js";
import { decryptText, encryptText, generateVirtualKey, randomId } from "../core/crypto.js";
import { addProviderKey, listProviderKeys } from "./keyPool.js";
import { parsePricing, type ModelPrice } from "./pricing.js";

export interface ProviderView {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  models: string[];
  pricing: Record<string, ModelPrice>;
  enabled: boolean;
  keyCount: number;
  createdAt: number;
}

export function toProviderView(row: ProviderRow, db?: Db): ProviderView {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl: row.base_url,
    models: JSON.parse(row.models_json) as string[],
    pricing: parsePricing(row.pricing_json),
    enabled: !!row.enabled,
    keyCount: db ? listProviderKeys(db, row.id).length : 1,
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
    pricing_json: "{}",
    enabled: 1,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO providers (id, name, type, base_url, key_enc, models_json, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.name, row.type, row.base_url, row.key_enc, row.models_json, row.enabled, row.created_at);
  addProviderKey(db, secret, row.id, input.apiKey, "默认");
  return toProviderView(row, db);
}

export function setProviderEnabled(db: Db, id: string, enabled: boolean): boolean {
  const r = db.prepare("UPDATE providers SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  return r.changes > 0;
}

export function updateProvider(
  db: Db,
  secret: string,
  id: string,
  patch: { name?: string; type?: string; baseUrl?: string; apiKey?: string; models?: string[]; pricing?: Record<string, ModelPrice> },
): ProviderView | null {
  const row = db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as unknown as ProviderRow | undefined;
  if (!row) return null;
  const name = patch.name?.trim() || row.name;
  const type = patch.type?.trim() || row.type;
  const baseUrl = patch.baseUrl?.trim() || row.base_url;
  const keyEnc = patch.apiKey ? encryptText(patch.apiKey, secret) : row.key_enc;
  const modelsJson = patch.models ? JSON.stringify(patch.models) : row.models_json;
  const pricingJson = patch.pricing ? JSON.stringify(patch.pricing) : row.pricing_json;
  db.prepare("UPDATE providers SET name = ?, type = ?, base_url = ?, key_enc = ?, models_json = ?, pricing_json = ? WHERE id = ?").run(
    name,
    type,
    baseUrl,
    keyEnc,
    modelsJson,
    pricingJson,
    id,
  );
  if (patch.apiKey) {
    const poolKeys = listProviderKeys(db, id);
    if (poolKeys.length === 0) {
      addProviderKey(db, secret, id, patch.apiKey, "默认");
    } else if (poolKeys.length === 1) {
      db.prepare("UPDATE provider_keys SET key_enc = ?, fail_count = 0, cooldown_until = NULL WHERE id = ?").run(keyEnc, poolKeys[0].id);
    }
  }
  const updated = db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as unknown as ProviderRow;
  return toProviderView(updated, db);
}

export function deleteProvider(db: Db, id: string): boolean {
  return db.prepare("DELETE FROM providers WHERE id = ?").run(id).changes > 0;
}

export function findProviderForModel(db: Db, model: string, preferType?: string): ProviderRow | null {
  return findProvidersForModel(db, model, preferType)[0] ?? null;
}

export function findProvidersForModel(db: Db, model: string, preferType?: string): ProviderRow[] {
  const rows = db
    .prepare("SELECT * FROM providers WHERE enabled = 1 ORDER BY created_at ASC")
    .all() as unknown as ProviderRow[];
  const match = (r: ProviderRow) => {
    const models = JSON.parse(r.models_json) as string[];
    return models.length === 0 || models.includes(model);
  };
  const matched = rows.filter(match);
  if (preferType) {
    return [...matched.filter((r) => r.type === preferType), ...matched.filter((r) => r.type !== preferType)];
  }
  return matched;
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
