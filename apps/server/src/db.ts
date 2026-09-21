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
  visibility TEXT NOT NULL DEFAULT 'team',
  created_at INTEGER NOT NULL,
  UNIQUE(grp, name)
);
CREATE TABLE IF NOT EXISTS repo_members (
  repo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, user_id)
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
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  sender_user_id TEXT,
  sender_role_id TEXT,
  type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_channel ON messages(channel_id, created_at);
CREATE TABLE IF NOT EXISTS ai_roles (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  name TEXT NOT NULL,
  persona_prompt TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  trigger_kind TEXT NOT NULL DEFAULT 'mention',
  trigger_keywords TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);
CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_id TEXT,
  user_id TEXT NOT NULL,
  workdir TEXT NOT NULL,
  run_cmd TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'stopped',
  pid INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

export function openDb(config: ServerConfig): Db {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(config.dataDir, "teamai.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  migrate(db);
  seedAdmin(db);
  return db;
}

function migrate(db: Db) {
  const addColumn = (table: string, column: string, ddl: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  addColumn("repos", "visibility", "visibility TEXT NOT NULL DEFAULT 'team'");
  addColumn("ai_roles", "trigger_keywords", "trigger_keywords TEXT NOT NULL DEFAULT ''");
  addColumn("users", "department_id", "department_id TEXT");
  addColumn("users", "title", "title TEXT NOT NULL DEFAULT ''");
  addColumn("channels", "topic", "topic TEXT NOT NULL DEFAULT ''");
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
