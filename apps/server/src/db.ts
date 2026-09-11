import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "./config.js";
import { hashPassword, randomId } from "./modules/core/crypto.js";

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  key_enc TEXT NOT NULL,
  models_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS virtual_keys (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  quota_tokens INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  estimated INTEGER NOT NULL DEFAULT 0,
  cli TEXT,
  task_id TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user_ts ON usage_records(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_records(model);
CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grp TEXT NOT NULL DEFAULT 'default',
  owner_id TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(grp, name)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL DEFAULT '',
  cli TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  archive_path TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
`;

export function openDb(config: ServerConfig): Db {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(config.dataDir, "teamai.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  seedAdmin(db);
  return db;
}

function seedAdmin(db: Db) {
  const row = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (row) return;
  const email = process.env.TEAMAI_ADMIN_EMAIL ?? "admin@teamai.local";
  const password = process.env.TEAMAI_ADMIN_PASSWORD ?? "admin123";
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)",
  ).run(randomId(), "Admin", email, hashPassword(password), Date.now());
  console.log(`[teamai] seeded admin account: ${email} (default password: ${password}, please change)`);
}
