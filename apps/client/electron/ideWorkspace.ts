import { promises as fs } from "node:fs";
import path from "node:path";

const IGNORED = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-electron",
  "build",
  "out",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".cache",
  ".DS_Store",
  "coverage",
  "release",
]);

const MAX_FILE_SIZE = 2 * 1024 * 1024;

export interface IdeNode {
  name: string;
  path: string;
  dir: boolean;
}

export interface IdeFile {
  content: string;
  binary: boolean;
  size: number;
}

function resolveInRoot(root: string, rel: string): string {
  const absRoot = path.resolve(root);
  const abs = path.resolve(absRoot, rel);
  if (abs !== absRoot && !abs.startsWith(absRoot + path.sep)) {
    throw new Error("非法路径：越出工作目录");
  }
  return abs;
}

export async function ideListDir(root: string, rel = ""): Promise<IdeNode[]> {
  const abs = resolveInRoot(root, rel);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  return entries
    .filter((e) => !IGNORED.has(e.name))
    .map((e) => ({
      name: e.name,
      path: rel ? `${rel}/${e.name}` : e.name,
      dir: e.isDirectory(),
    }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}

export async function ideReadFile(root: string, rel: string): Promise<IdeFile> {
  const abs = resolveInRoot(root, rel);
  const stat = await fs.stat(abs);
  if (stat.isDirectory()) throw new Error("目标是一个目录");
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`文件过大（${(stat.size / 1024 / 1024).toFixed(1)}MB），仅支持打开 2MB 以内的文本文件`);
  }
  const buf = await fs.readFile(abs);
  const binary = buf.includes(0);
  return {
    content: binary ? "" : buf.toString("utf8"),
    binary,
    size: stat.size,
  };
}

export async function ideWriteFile(root: string, rel: string, content: string): Promise<{ size: number }> {
  const abs = resolveInRoot(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  const stat = await fs.stat(abs);
  return { size: stat.size };
}
