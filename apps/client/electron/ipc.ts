import { ipcMain, dialog } from "electron";
import { detectClis } from "./headlessManager.js";
import { listModelRoutes } from "./modelRegistry.js";
import { cloneRepo } from "./gitWorkspace.js";
import {
  checkServerHealth,
  chatStream,
  createRepo,
  deleteRepo,
  gitRemoteUrl,
  listModels,
  listRepos,
  login,
  repoCommits,
  saveSession,
  setConnection,
  usageSummary,
  type ChatMessage,
} from "./serverClient.js";

export function registerIpcHandlers() {
  ipcMain.handle("cli:detect", () => detectClis());
  ipcMain.handle("models:routes", () => listModelRoutes());
  ipcMain.handle("server:health", () => checkServerHealth());
  ipcMain.handle("server:setUrl", (_e, url: string) => {
    setConnection(url, null);
    return true;
  });
  ipcMain.handle("auth:login", (_e, email: string, password: string) => login(email, password));
  ipcMain.handle("models:list", () => listModels());
  ipcMain.handle("usage:summary", () => usageSummary());

  ipcMain.handle("repos:list", () => listRepos());
  ipcMain.handle("repos:create", (_e, name: string, group: string) => createRepo(name, group));
  ipcMain.handle("repos:delete", (_e, id: string) => deleteRepo(id));
  ipcMain.handle("repos:commits", (_e, id: string) => repoCommits(id));
  ipcMain.handle("repos:remoteUrl", (_e, group: string, name: string, email: string) =>
    gitRemoteUrl(group, name, email),
  );
  ipcMain.handle("dialog:pickDir", async () => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("git:clone", (_e, repoUrl: string, targetDir: string) =>
    cloneRepo(repoUrl, targetDir),
  );
  ipcMain.handle(
    "sessions:save",
    (_e, input: { title?: string; cli?: string; taskId?: string; messages: unknown[] }) =>
      saveSession(input),
  );

  ipcMain.handle(
    "chat:send",
    async (event, req: { requestId: string; model: string; messages: ChatMessage[] }) => {
      try {
        await chatStream(req.model, req.messages, (delta) => {
          event.sender.send("chat:chunk", { requestId: req.requestId, delta });
        });
        event.sender.send("chat:chunk", { requestId: req.requestId, done: true });
      } catch (err) {
        event.sender.send("chat:chunk", {
          requestId: req.requestId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
