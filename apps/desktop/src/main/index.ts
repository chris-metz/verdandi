import { homedir } from "node:os";
import { join } from "node:path";
import {
  createCore,
  createGhAdapter,
  createSettingsFile,
  desktopStateDirectory,
  runCommand,
  type HostEnvironment,
} from "@verdandi/core";
import {
  eventNames,
  requestNames,
  type Contract,
  type CoreRequests,
} from "@verdandi/core/contract";
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import { ipcChannels } from "../shared/ipc";

const host: HostEnvironment = {
  platform: process.platform,
  env: process.env,
  homedir: homedir(),
};

// Before anything touches it: keep Chromium's data out of ~/.config on Linux
// and out of the roaming profile on Windows.
app.setPath("userData", desktopStateDirectory(host));

const core = createCore({
  github: createGhAdapter({ runCommand }),
  settings: createSettingsFile(host),
});

wireContract(core);
// The renderer's one way to open a link, e.g. `o` on an issue.
ipcMain.on(ipcChannels.openExternal, (_event, url: unknown) => {
  if (typeof url === "string") openExternal(url);
});

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/** Forwards contract requests from renderers and pushes events to them. */
function wireContract(contract: Contract) {
  ipcMain.handle(
    ipcChannels.request,
    (_event, name: unknown, args: unknown) => {
      if (!isRequestName(name) || !Array.isArray(args)) {
        throw new Error(`Unknown request: ${String(name)}`);
      }
      const request = contract[name] as (
        ...args: unknown[]
      ) => Promise<unknown>;
      return request(...(args as unknown[]));
    },
  );
  for (const name of eventNames) {
    contract.on(name, (payload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(ipcChannels.event, name, payload);
      }
    });
  }
}

function isRequestName(name: unknown): name is keyof CoreRequests {
  return requestNames.includes(name as keyof CoreRequests);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: "Verdandi",
    // Matches the page background, so the window does not flash on opening.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.once("ready-to-show", () => {
    window.show();
  });

  // The window only ever shows Verdandi; links leave for the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url === window.webContents.getURL()) return;
    event.preventDefault();
    openExternal(url);
  });

  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) void window.loadURL(devServer);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
}

/** Opens a link in the browser, but only an `https://` one. */
function openExternal(url: string) {
  if (URL.parse(url)?.protocol === "https:") void shell.openExternal(url);
}
