import { create } from "zustand";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AppState {
  serverUrl: string;
  token: string | null;
  user: SessionUser | null;
  setServerUrl: (url: string) => void;
  setAuth: (token: string, user: SessionUser) => void;
  logout: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  serverUrl: "http://localhost:8787",
  token: null,
  user: null,
  setServerUrl: (serverUrl) => set({ serverUrl }),
  setAuth: (token, user) => set({ token, user }),
  logout: () => set({ token: null, user: null }),
}));
