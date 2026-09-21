import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function cloneRepo(repoUrl: string, targetDir: string): Promise<void> {
  await execFileAsync("git", ["clone", repoUrl, targetDir]);
}

export async function currentBranch(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return stdout.trim();
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return `${stdout}${stderr}`.trim();
}

async function gitSafe(cwd: string, args: string[]): Promise<string> {
  try {
    return await git(cwd, args);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || (e.message ?? "git error");
  }
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export interface PushResult {
  output: string;
  commitHash: string;
  pushed: boolean;
}

export async function pushWorkspace(
  cwd: string,
  remoteUrl: string,
  message: string,
  author: { name: string; email: string },
): Promise<PushResult> {
  const logs: string[] = [];
  if (!(await isGitRepo(cwd))) {
    logs.push(await git(cwd, ["init", "-b", "main"]));
    logs.push("[teamai] 已初始化 git 仓库");
  }
  await gitSafe(cwd, ["config", "user.name", author.name]);
  await gitSafe(cwd, ["config", "user.email", author.email]);

  logs.push(await git(cwd, ["add", "-A"]));
  let commitHash = "";
  try {
    const out = await git(cwd, ["commit", "-m", message]);
    logs.push(out);
    commitHash = (await git(cwd, ["rev-parse", "--short", "HEAD"])).trim();
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    const out = `${e?.stdout ?? ""}${e?.stderr ?? ""}`;
    if (/nothing to commit|无文件要提交|nothing added/i.test(out)) {
      logs.push("[teamai] 没有新的改动，直接推送当前 HEAD");
      commitHash = (await git(cwd, ["rev-parse", "--short", "HEAD"])).trim();
    } else {
      throw new Error(out || "git commit 失败");
    }
  }

  await gitSafe(cwd, ["remote", "remove", "origin"]);
  logs.push(await git(cwd, ["remote", "add", "origin", remoteUrl]));
  const pushOut = await git(cwd, ["push", "-u", "origin", "HEAD:main"]);
  logs.push(pushOut);
  return { output: logs.filter(Boolean).join("\n"), commitHash, pushed: true };
}
