import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const serverTarget = process.env.TEAMAI_SERVER ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: serverTarget, changeOrigin: true },
      "/v1": { target: serverTarget, changeOrigin: true },
      "/health": { target: serverTarget, changeOrigin: true },
      "/ws": { target: serverTarget, changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: "dist",
  },
});
