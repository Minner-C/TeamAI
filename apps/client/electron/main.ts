import { app, BrowserWindow, Menu, shell } from "electron";
import path from "node:path";
import { registerIpcHandlers } from "./ipc.js";
import { disposeAgentRunners } from "./agentRunner.js";

const isDev = !!process.env.VITE_DEV_SERVER_URL || !app.isPackaged;

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "TeamAI",
    icon: path.join(__dirname, "../build/icon.png"),
    autoHideMenuBar: true,
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexHtml = path.join(__dirname, "../dist/index.html");
    win.webContents.on("did-fail-load", (_e, code, desc) => {
      win.webContents
        .executeJavaScript(
          `document.body.innerHTML = '<div style="color:#ddd;font:14px sans-serif;padding:40px">界面加载失败（${code}）：${desc}<br/>请尝试重新安装 TeamAI。</div>'`,
        )
        .catch(() => undefined);
    });
    await win.loadFile(indexHtml);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("com.teamai.client");
    if (!isDev) Menu.setApplicationMenu(null);
    registerIpcHandlers();
    void createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on("before-quit", () => {
    disposeAgentRunners();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
