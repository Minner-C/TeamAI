import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Db } from "../../db.js";
import { setEnvStatus, type EnvRow } from "./store.js";

const execFileAsync = promisify(execFile);

const LOG_TAIL_LIMIT = 2000;
const logBuffers = new Map<string, string[]>();
const running = new Map<string, ReturnType<typeof spawn>>();
const intentionalStops = new Set<string>();

function pushLog(envId: string, line: string) {
  let buf = logBuffers.get(envId);
  if (!buf) {
    buf = [];
    logBuffers.set(envId, buf);
  }
  for (const part of line.split("\n")) {
    if (part.length) buf.push(part);
  }
  if (buf.length > LOG_TAIL_LIMIT) buf.splice(0, buf.length - LOG_TAIL_LIMIT);
}

export function envLogs(envId: string, tail = 200): string[] {
  const buf = logBuffers.get(envId) ?? [];
  return buf.slice(-Math.min(tail, LOG_TAIL_LIMIT));
}

export function isRunning(envId: string): boolean {
  return running.has(envId);
}

export function startEnv(db: Db, env: EnvRow): { pid: number } {
  if (!env.run_cmd.trim()) throw new Error("run command is empty");
  if (running.has(env.id)) throw new Error("env already running");

  const child = spawn("sh", ["-c", env.run_cmd], {
    cwd: env.workdir,
    env: { ...process.env, TEAMAI_ENV_ID: env.id },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  if (!child.pid) throw new Error("failed to spawn process");

  running.set(env.id, child);
  logBuffers.set(env.id, []);
  pushLog(env.id, `[teamai] started: ${env.run_cmd} (pid ${child.pid})`);
  setEnvStatus(db, env.id, "running", child.pid);

  child.stdout?.on("data", (d: Buffer) => pushLog(env.id, d.toString("utf8")));
  child.stderr?.on("data", (d: Buffer) => pushLog(env.id, d.toString("utf8")));
  child.on("exit", (code, signal) => {
    running.delete(env.id);
    pushLog(env.id, `[teamai] exited code=${code ?? "-"} signal=${signal ?? "-"}`);
    const stoppedByUser = intentionalStops.delete(env.id);
    setEnvStatus(db, env.id, stoppedByUser || code === 0 ? "stopped" : "error", null);
  });
  child.on("error", (err) => {
    running.delete(env.id);
    pushLog(env.id, `[teamai] spawn error: ${err.message}`);
    setEnvStatus(db, env.id, "error", null);
  });

  return { pid: child.pid };
}

export function stopEnv(db: Db, env: EnvRow): void {
  const child = running.get(env.id);
  if (child) {
    intentionalStops.add(env.id);
    try {
      process.kill(-(child.pid ?? 0), "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    running.delete(env.id);
    pushLog(env.id, "[teamai] stopped by user");
  }
  setEnvStatus(db, env.id, "stopped", null);
}

export async function execInEnv(
  env: EnvRow,
  cmd: string,
  timeoutMs = 30000,
): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("sh", ["-c", cmd], {
      cwd: env.workdir,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, output: stdout + (stderr ? `\n[stderr]\n${stderr}` : "") };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string; killed?: boolean };
    return {
      code: typeof e.code === "number" ? e.code : 1,
      output: `${e.stdout ?? ""}${e.stderr ? `\n[stderr]\n${e.stderr}` : ""}${e.killed ? "\n[teamai] timeout" : ""}`.trim() || (e.message ?? "exec failed"),
    };
  }
}

export function reconcileOnBoot(db: Db) {
  db.prepare("UPDATE environments SET status = 'stopped', pid = NULL WHERE status = 'running'").run();
}
