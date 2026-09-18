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
  serverHealth: () => ipcRenderer.invoke("server:health"),
  setServerUrl: (url: string) => ipcRenderer.invoke("server:setUrl", url),
  login: (email: string, password: string) => ipcRenderer.invoke("auth:login", email, password),
  listModels: () => ipcRenderer.invoke("models:list"),
  usageSummary: () => ipcRenderer.invoke("usage:summary"),
  listRepos: () => ipcRenderer.invoke("repos:list"),
  createRepo: (name: string, group: string) => ipcRenderer.invoke("repos:create", name, group),
  deleteRepo: (id: string) => ipcRenderer.invoke("repos:delete", id),
  repoCommits: (id: string) => ipcRenderer.invoke("repos:commits", id),
  repoRemoteUrl: (group: string, name: string, email: string) =>
    ipcRenderer.invoke("repos:remoteUrl", group, name, email),
  pickDir: () => ipcRenderer.invoke("dialog:pickDir"),
  gitClone: (repoUrl: string, targetDir: string) =>
    ipcRenderer.invoke("git:clone", repoUrl, targetDir),
  saveSession: (input: { title?: string; cli?: string; taskId?: string; messages: unknown[] }) =>
    ipcRenderer.invoke("sessions:save", input),
  imConnect: () => ipcRenderer.invoke("im:connect"),
  imTyping: (channelId: string) => ipcRenderer.invoke("im:typing", channelId),
  onImEvent: (handler: (event: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, ev: unknown) => handler(ev);
    ipcRenderer.on("im:event", listener);
    return () => ipcRenderer.removeListener("im:event", listener);
  },
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
