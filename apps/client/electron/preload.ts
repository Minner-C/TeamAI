import { contextBridge, ipcRenderer } from "electron";

const api = {
  detectClis: () => ipcRenderer.invoke("cli:detect"),
  listModels: () => ipcRenderer.invoke("models:list"),
  gitClone: (repoUrl: string, targetDir: string) =>
    ipcRenderer.invoke("git:clone", repoUrl, targetDir),
  serverHealth: () => ipcRenderer.invoke("server:health"),
};

export type TeamAiApi = typeof api;

contextBridge.exposeInMainWorld("teamai", api);
