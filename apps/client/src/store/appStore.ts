import { create } from "zustand";
import { api, type SessionUser } from "../api";

export type PageKey = "agent" | "im" | "repos" | "usage" | "settings";

interface AppState {
  serverUrl: string;
  token: string | null;
  user: SessionUser | null;
  page: PageKey;
  agentDraft: string;
  setServerUrl: (url: string) => void;
  setAuth: (token: string, user: SessionUser) => void;
  logout: () => void;
  setPage: (page: PageKey) => void;
  feedToAgent: (text: string) => void;
  clearAgentDraft: () => void;
}

const restored = api.restoreSession();

export const useAppStore = create<AppState>((set) => ({
  serverUrl: "http://localhost:8787",
  token: restored?.token ?? null,
  user: restored?.user ?? null,
  page: "agent",
  agentDraft: "",
  setServerUrl: (serverUrl) => set({ serverUrl }),
  setAuth: (token, user) => set({ token, user }),
  logout: () => {
    api.clearSession();
    set({ token: null, user: null });
  },
  setPage: (page) => set({ page }),
  feedToAgent: (text) => set({ agentDraft: text, page: "agent" }),
  clearAgentDraft: () => set({ agentDraft: "" }),
}));
