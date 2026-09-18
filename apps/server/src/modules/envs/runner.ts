import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type { Db } from "../../db.js";
import type { ServerConfig } from "../../config.js";
import { setEnvStatus, type EnvRow } from "./store.js";

const execFileAsync = promisify(execFile);

const LOG_TAIL_LIMIT = 2000;
const logBuffers = new Map<string, string[]>();
const running = new Map<string, ChildProcess>();
const intentionalStops = new Set<string>();

type Backend = "process" | "docker";
let backend: Backend = "process";
let envImage = "node:22-alpine";

async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function initRunner(config: ServerConfig): Promise<Backend> {
  envImage = config.envImage;
  if (config.envRunner === "process") backend = "process";
  else if (config.envRunner === "docker") backend = (await dockerAvailable()) ? "docker" : "process";
  else backend = (await dockerAvailable()) ? "docker" : "process";
  return backend;
}

export function currentBackend(): Backend {
  return backend;
}

function containerName(envId: string): string {
  return `teamai-env-${envId}`;
}

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

export async function envLogs(envId: string, tail = 200): Promise<string[]> {
  const buf = logBuffers.get(envId) ?? [];
  if (buf.length > 0 || backend === "process") {
    return buf.slice(-Math.min(tail, LOG_TAIL_LIMIT));
  }
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["logs", "--tail", String(Math.min(tail, LOG_TAIL_LIMIT)), containerName(envId)],
      { maxBuffer: 2 * 1024 * 1024, timeout: 10000 },
    );
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function isRunning(envId: string): boolean {
  return running.has(envId);
}

export async function startEnv(db: Db, env: EnvRow): Promise<{ pid: number | null }> {
  if (!env.run_cmd.trim()) throw new Error("run command is empty");
  if (running.has(env.id)) throw new Error("env already running");
  return backend === "docker" ? startEnvDocker(db, env) : startEnvProcess(db, env);
}

function startEnvProcess(db: Db, env: EnvRow): { pid: number | null } {
  const child = spawn("sh", ["-c", env.run_cmd], {
    cwd: env.workdir,
    env: { ...process.env, TEAMAI_ENV_ID: env.id },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  if (!child.pid) throw new Error("failed to spawn process");

  running.set(env.id, child);
  logBuffers.set(env.id, []);
  pushLog(env.id, `[teamai] started (process backend): ${env.run_cmd} (pid ${child.pid})`);
  setEnvStatus(db, env.id, "running", child.pid);
  wireExit(db, env.id, child);
  return { pid: child.pid };
}

function wireExit(db: Db, envId: string, child: ChildProcess) {
  child.stdout?.on("data", (d: Buffer) => pushLog(envId, d.toString("utf8")));
  child.stderr?.on("data", (d: Buffer) => pushLog(envId, d.toString("utf8")));
  child.on("exit", (code, signal) => {
    running.delete(envId);
    pushLog(envId, `[teamai] exited code=${code ?? "-"} signal=${signal ?? "-"}`);
    const stoppedByUser = intentionalStops.delete(envId);
    setEnvStatus(db, envId, stoppedByUser || code === 0 ? "stopped" : "error", null);
  });
  child.on("error", (err) => {
    running.delete(envId);
    pushLog(envId, `[teamai] spawn error: ${err.message}`);
    setEnvStatus(db, envId, "error", null);
  });
}

async function startEnvDocker(db: Db, env: EnvRow): Promise<{ pid: number | null }> {
  if (!(await dockerAvailable())) throw new Error("docker backend selected but docker is not available");
  const name = containerName(env.id);
  await execFileAsync("docker", ["rm", "-f", name]).catch(() => {});
  await execFileAsync("docker", [
    "run", "-d",
    "--name", name,
    "-v", `${env.workdir}:/workspace`,
    "-w", "/workspace",
    "-e", `TEAMAI_ENV_ID=${env.id}`,
    "--network", "bridge",
    envImage,
    "sh", "-c", env.run_cmd,
  ]);

  logBuffers.set(env.id, []);
  pushLog(env.id, `[teamai] started (docker backend, image ${envImage}): ${env.run_cmd}`);
  setEnvStatus(db, env.id, "running", null);

  const follow = spawn("docker", ["logs", "-f", "--tail", "100", name], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  running.set(env.id, follow);
  follow.stdout?.on("data", (d: Buffer) => pushLog(env.id, d.toString("utf8")));
  follow.stderr?.on("data", (d: Buffer) => pushLog(env.id, d.toString("utf8")));

  const waiter = spawn("docker", ["wait", name], { stdio: ["ignore", "pipe", "pipe"] });
  let exitCode = "";
  waiter.stdout?.on("data", (d: Buffer) => (exitCode += d.toString()));
  waiter.on("close", () => {
    follow.kill("SIGTERM");
    running.delete(env.id);
    const code = Number(exitCode.trim());
    pushLog(env.id, `[teamai] container exited code=${Number.isNaN(code) ? "-" : code}`);
    const stoppedByUser = intentionalStops.delete(env.id);
    setEnvStatus(db, env.id, stoppedByUser || code === 0 ? "stopped" : "error", null);
  });

  return { pid: null };
}

export async function stopEnv(db: Db, env: EnvRow): Promise<void> {
  intentionalStops.add(env.id);
  const child = running.get(env.id);
  if (backend === "docker") {
    await execFileAsync("docker", ["rm", "-f", containerName(env.id)]).catch(() => {});
    child?.kill("SIGTERM");
    running.delete(env.id);
    pushLog(env.id, "[teamai] stopped by user");
  } else if (child) {
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
  const argv =
    backend === "docker" && isRunning(env.id)
      ? { cmd: "docker" as const, args: ["exec", "-w", "/workspace", containerName(env.id), "sh", "-c", cmd] }
      : { cmd: "sh" as const, args: ["-c", cmd] };
  try {
    const { stdout, stderr } = await execFileAsync(argv.cmd, argv.args, {
      cwd: backend === "docker" ? undefined : env.workdir,
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

export async function reconcileOnBoot(db: Db): Promise<void> {
  if (backend !== "docker") {
    db.prepare("UPDATE environments SET status = 'stopped', pid = NULL WHERE status = 'running'").run();
    return;
  }
  const rows = db
    .prepare("SELECT * FROM environments WHERE status = 'running'")
    .all() as unknown as EnvRow[];
  for (const env of rows) {
    try {
      const { stdout } = await execFileAsync("docker", [
        "inspect", "-f", "{{.State.Running}}", containerName(env.id),
      ]);
      if (stdout.trim() === "true") {
        const follow = spawn("docker", ["logs", "-f", "--tail", "100", containerName(env.id)], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        running.set(env.id, follow);
        follow.stdout?.on("data", (d: Buffer) => pushLog(env.id, d.toString("utf8")));
        follow.stderr?.on("data", (d: Buffer) => pushLog(env.id, d.toString("utf8")));
        continue;
      }
    } catch {
      // container gone
    }
    setEnvStatus(db, env.id, "stopped", null);
  }
}
