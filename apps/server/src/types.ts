import type { Db } from "./db.js";
import type { ServerConfig } from "./config.js";
import type { UserRole } from "@teamai/shared";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: number;
}

export interface ProviderRow {
  id: string;
  name: string;
  type: string;
  base_url: string;
  key_enc: string;
  models_json: string;
  enabled: number;
  created_at: number;
}

export interface VirtualKeyRow {
  id: string;
  key: string;
  user_id: string;
  name: string;
  quota_tokens: number | null;
  revoked_at: number | null;
  created_at: number;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    config: ServerConfig;
  }
  interface FastifyRequest {
    user?: UserRow;
    virtualKey?: VirtualKeyRow;
  }
}
