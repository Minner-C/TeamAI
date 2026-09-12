import type { Db } from "../../db.js";
import { randomId } from "../core/crypto.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import type { RepoRow } from "../git/store.js";

const execFileAsync = promisify(execFile);

export interface EnvRow {
  id: string;
  name: string;
  repo_id: string | null;
  user_id: string;
  workdir: string;
  run_cmd: string;
  status: string;
  pid: number | null;
  created_at: number;
}

export interface EnvView {
  id: string;
  name: string;
  repoId: string | null;
  repoName: string | null;
  userId: string;
  userName: string;
  runCmd: string;
  status: string;
  pid: number | null;
  createdAt: number;
}

export function envsDir(dataDir: string): string {
  return path.join(dataDir, "envs");
}

export function toEnvView(db: Db, r: EnvRow): EnvView {
  const repo = r.repo_id
    ? (db.prepare("SELECT grp, name FROM repos WHERE id = ?").get(r.repo_id) as
        | Pick<RepoRow, "grp" | "name">
        | undefined)
    : undefined;
  const user = db.prepare("SELECT name FROM users WHERE id = ?").get(r.user_id) as
    | { name: string }
    | undefined;
  return {
    id: r.id,
    name: r.name,
    repoId: r.repo_id,
    repoName: repo ? `${repo.grp}/${repo.name}` : null,
    userId: r.user_id,
    userName: user?.name ?? "?",
    runCmd: r.run_cmd,
    status: r.status,
    pid: r.pid,
    createdAt: r.created_at,
  };
}

export function getEnv(db: Db, id: string): EnvRow | undefined {
  return db.prepare("SELECT * FROM environments WHERE id = ?").get(id) as EnvRow | undefined;
}

export function listEnvs(db: Db, userId?: string): EnvRow[] {
  if (userId) {
    return db
      .prepare("SELECT * FROM environments WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as unknown as EnvRow[];
  }
  return db.prepare("SELECT * FROM environments ORDER BY created_at DESC").all() as unknown as EnvRow[];
}

export async function createEnv(
  db: Db,
  dataDir: string,
  input: { name: string; repoId?: string; userId: string; runCmd?: string },
): Promise<EnvRow> {
  const name = input.name.trim();
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9._ -]{1,64}$/.test(name)) throw new Error("invalid env name");
  const id = randomId();
  const workdir = path.join(envsDir(dataDir), id);
  fs.mkdirSync(workdir, { recursive: true });

  let repoId: string | null = null;
  if (input.repoId) {
    const repo = db.prepare("SELECT * FROM repos WHERE id = ?").get(input.repoId) as RepoRow | undefined;
    if (!repo) throw new Error("repo not found");
    repoId = repo.id;
    fs.rmSync(workdir, { recursive: true, force: true });
    await execFileAsync("git", ["clone", repo.path, workdir]);
  }

  db.prepare(
    "INSERT INTO environments (id, name, repo_id, user_id, workdir, run_cmd, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'stopped', ?)",
  ).run(id, name, repoId, input.userId, workdir, input.runCmd ?? "", Date.now());
  return getEnv(db, id)!;
}

export function setEnvStatus(db: Db, id: string, status: string, pid: number | null) {
  db.prepare("UPDATE environments SET status = ?, pid = ? WHERE id = ?").run(status, pid, id);
}

export async function deleteEnv(db: Db, id: string): Promise<void> {
  const row = getEnv(db, id);
  if (!row) return;
  db.prepare("DELETE FROM environments WHERE id = ?").run(id);
  await fs.promises.rm(row.workdir, { recursive: true, force: true });
}
