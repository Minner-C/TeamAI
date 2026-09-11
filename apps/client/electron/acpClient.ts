import type { CliKind } from "@teamai/shared";

export interface AcpSession {
  taskId: string;
  cwd: string;
}

export class AcpClient {
  private sessions = new Map<string, AcpSession>();

  async startSession(taskId: string, cwd: string): Promise<AcpSession> {
    const session: AcpSession = { taskId, cwd };
    this.sessions.set(taskId, session);
    return session;
  }

  async stopSession(taskId: string): Promise<void> {
    this.sessions.delete(taskId);
  }
}

export const acpCli: CliKind = "kimi";
