import { create } from "zustand";
import { api, type SessionUser } from "../api";

export type PageKey = "agent" | "im" | "repos" | "envs" | "files" | "usage" | "settings";

interface AppState {
  serverUrl: string;
  token: string | null;
  user: SessionUser | null;
  offline: boolean;
  page: PageKey;
  agentDraft: string;
  setServerUrl: (url: string) => void;
  setAuth: (token: string, user: SessionUser) => void;
  setOffline: (offline: boolean) => void;
  logout: () => void;
  setPage: (page: PageKey) => void;
  feedToAgent: (text: string) => void;
  clearAgentDraft: () => void;
}

const restored = api.restoreSession();

export const useAppStore = create<AppState>((set) => ({
  serverUrl: localStorage.getItem("teamai_server_url") ?? "",
  token: restored?.token ?? null,
  user: restored?.user ?? null,
  offline: localStorage.getItem("teamai_offline") === "1",
  page: "agent",
  agentDraft: "",
  setServerUrl: (serverUrl) => {
    void api.setServerUrl(serverUrl);
    set({ serverUrl });
  },
  setAuth: (token, user) => set({ token, user, offline: false }),
  setOffline: (offline) => {
    if (offline) localStorage.setItem("teamai_offline", "1");
    else localStorage.removeItem("teamai_offline");
    set({ offline, page: "agent" });
  },
  logout: () => {
    api.clearSession();
    localStorage.removeItem("teamai_offline");
    set({ token: null, user: null, offline: false });
  },
  setPage: (page) => set({ page }),
  feedToAgent: (text) => set({ agentDraft: text, page: "agent" }),
  clearAgentDraft: () => set({ agentDraft: "" }),
}));
