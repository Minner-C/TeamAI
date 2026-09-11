import type { Db } from "../../db.js";
import { randomId } from "../core/crypto.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface RepoRow {
  id: string;
  name: string;
  grp: string;
  owner_id: string;
  path: string;
  created_at: number;
}

const NAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;

export function validRepoPart(s: string): boolean {
  return NAME_RE.test(s);
}

export function repoDiskPath(reposDir: string, grp: string, name: string): string {
  return path.join(reposDir, grp, `${name}.git`);
}

export function listRepos(db: Db): RepoRow[] {
  return db.prepare("SELECT * FROM repos ORDER BY created_at DESC").all() as unknown as RepoRow[];
}

export function findRepo(db: Db, grp: string, name: string): RepoRow | undefined {
  return db.prepare("SELECT * FROM repos WHERE grp = ? AND name = ?").get(grp, name) as
    | RepoRow
    | undefined;
}

export async function createRepo(
  db: Db,
  reposDir: string,
  input: { name: string; grp: string; ownerId: string },
): Promise<RepoRow> {
  if (!validRepoPart(input.name) || !validRepoPart(input.grp)) {
    throw new Error("invalid repo name or group");
  }
  if (findRepo(db, input.grp, input.name)) throw new Error("repo already exists");
  const diskPath = repoDiskPath(reposDir, input.grp, input.name);
  fs.mkdirSync(path.dirname(diskPath), { recursive: true });
  await execFileAsync("git", ["init", "--bare", "-b", "main", diskPath]);
  await execFileAsync("git", ["-C", diskPath, "config", "http.receivepack", "true"]);
  const row: RepoRow = {
    id: randomId(),
    name: input.name,
    grp: input.grp,
    owner_id: input.ownerId,
    path: diskPath,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO repos (id, name, grp, owner_id, path, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.name, row.grp, row.owner_id, row.path, row.created_at);
  return row;
}

export async function deleteRepo(db: Db, id: string): Promise<boolean> {
  const row = db.prepare("SELECT * FROM repos WHERE id = ?").get(id) as RepoRow | undefined;
  if (!row) return false;
  db.prepare("DELETE FROM repos WHERE id = ?").run(id);
  fs.rmSync(row.path, { recursive: true, force: true });
  return true;
}

async function resolveRef(row: RepoRow, ref: string): Promise<string> {
  if (ref !== "HEAD") return ref;
  try {
    await execFileAsync("git", ["-C", row.path, "rev-parse", "--verify", "HEAD"]);
    return "HEAD";
  } catch {
    const { stdout } = await execFileAsync("git", ["-C", row.path, "for-each-ref", "--format=%(refname)"]);
    return stdout.split("\n").filter(Boolean)[0] ?? "HEAD";
  }
}

export async function repoCommits(row: RepoRow, ref = "HEAD", limit = 20) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", row.path, "log", await resolveRef(row, ref), `--max-count=${limit}`, "--pretty=format:%h%x09%an%x09%at%x09%s"],
    );
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, author, at, ...msg] = line.split("\t");
        return { hash, author, at: Number(at), message: msg.join("\t") };
      });
  } catch {
    return [];
  }
}

export async function repoTree(row: RepoRow, ref = "HEAD") {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", row.path, "ls-tree", "-r", "--long", await resolveRef(row, ref)],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(\d+) (\w+) [0-9a-f]+\s+(\d+|-)\t(.+)$/);
        if (!m) return null;
        return { mode: m[1], type: m[2], size: m[3], path: m[4] };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
