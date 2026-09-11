import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  reposDir: string;
  jwtSecret: string;
}

export function loadConfig(): ServerConfig {
  const dataDir = process.env.TEAMAI_DATA_DIR ?? path.resolve(__dirname, "../../data");
  return {
    host: process.env.TEAMAI_HOST ?? "0.0.0.0",
    port: Number(process.env.TEAMAI_PORT ?? 8787),
    dataDir,
    reposDir: process.env.TEAMAI_REPOS_DIR ?? path.join(dataDir, "repos"),
    jwtSecret: process.env.TEAMAI_JWT_SECRET ?? "dev-only-secret-change-me",
  };
}
