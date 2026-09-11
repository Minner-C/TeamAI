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
