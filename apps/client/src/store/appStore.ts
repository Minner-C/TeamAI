import { create } from "zustand";

interface AppState {
  serverUrl: string;
  token: string | null;
  setServerUrl: (url: string) => void;
  setToken: (token: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  serverUrl: "http://localhost:8787",
  token: null,
  setServerUrl: (serverUrl) => set({ serverUrl }),
  setToken: (token) => set({ token }),
}));
