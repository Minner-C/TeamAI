import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export interface ChatChunk {
  requestId: string;
  delta?: string;
  done?: boolean;
  error?: string;
}

const api = {
  detectClis: () => ipcRenderer.invoke("cli:detect"),
  listModelRoutes: () => ipcRenderer.invoke("models:routes"),
  gitClone: (repoUrl: string, targetDir: string) =>
    ipcRenderer.invoke("git:clone", repoUrl, targetDir),
  serverHealth: () => ipcRenderer.invoke("server:health"),
  setServerUrl: (url: string) => ipcRenderer.invoke("server:setUrl", url),
  login: (email: string, password: string) => ipcRenderer.invoke("auth:login", email, password),
  listModels: () => ipcRenderer.invoke("models:list"),
  usageSummary: () => ipcRenderer.invoke("usage:summary"),
  chatSend: (requestId: string, model: string, messages: Array<{ role: string; content: string }>) =>
    ipcRenderer.invoke("chat:send", { requestId, model, messages }),
  onChatChunk: (handler: (chunk: ChatChunk) => void) => {
    const listener = (_e: IpcRendererEvent, chunk: ChatChunk) => handler(chunk);
    ipcRenderer.on("chat:chunk", listener);
    return () => ipcRenderer.removeListener("chat:chunk", listener);
  },
};

export type TeamAiApi = typeof api;

contextBridge.exposeInMainWorld("teamai", api);
