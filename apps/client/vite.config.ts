import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const monacoEsmVs = fileURLToPath(new URL("node_modules/monaco-editor/esm/vs/", import.meta.url));

const serverTarget = process.env.TEAMAI_SERVER ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: [
      { find: /^monaco-editor\/esm\/vs\//, replacement: monacoEsmVs },
    ],
  },
  optimizeDeps: {
    exclude: ["monaco-editor"],
  },
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
