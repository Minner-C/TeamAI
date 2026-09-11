import { ipcMain } from "electron";
import { detectClis } from "./headlessManager.js";
import { listModelRoutes } from "./modelRegistry.js";
import { cloneRepo } from "./gitWorkspace.js";
import { checkServerHealth } from "./serverClient.js";

export function registerIpcHandlers() {
  ipcMain.handle("cli:detect", () => detectClis());
  ipcMain.handle("models:list", () => listModelRoutes());
  ipcMain.handle("git:clone", (_e, repoUrl: string, targetDir: string) =>
    cloneRepo(repoUrl, targetDir),
  );
  ipcMain.handle("server:health", () => checkServerHealth());
}
