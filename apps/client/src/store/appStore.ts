import { create } from "zustand";
import { api, type SessionUser } from "../api";

interface AppState {
  serverUrl: string;
  token: string | null;
  user: SessionUser | null;
  setServerUrl: (url: string) => void;
  setAuth: (token: string, user: SessionUser) => void;
  logout: () => void;
}

const restored = api.restoreSession();

export const useAppStore = create<AppState>((set) => ({
  serverUrl: "http://localhost:8787",
  token: restored?.token ?? null,
  user: restored?.user ?? null,
  setServerUrl: (serverUrl) => set({ serverUrl }),
  setAuth: (token, user) => set({ token, user }),
  logout: () => {
    api.clearSession();
    set({ token: null, user: null });
  },
}));
