import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

process.env.VITE_DEV_SERVER_URL = "http://localhost:5173";

const vite = spawn("vite", [], { stdio: "inherit", shell: true });

await new Promise((r) => setTimeout(r, 2000));

await import("./build-electron.mjs");

const electronBin = require("electron");
const electron = spawn(electronBin, ["."], {
  stdio: "inherit",
  env: { ...process.env },
});

electron.on("close", () => {
  vite.kill();
  process.exit(0);
});
