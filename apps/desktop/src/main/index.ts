import { homedir } from "node:os";
import { join } from "node:path";
import {
  createCore,
  createGhAdapter,
  createLocalStateFile,
  createSettingsFile,
  desktopStateDirectory,
  runCommand,
  type HostEnvironment,
} from "@verdandi/core";
import {
  eventNames,
  type Contract,
  type CoreRequests,
} from "@verdandi/core/contract";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  type OpenDialogOptions,
} from "electron";
import {
  ipcChannels,
  rendererRequestNames,
  type DesktopApi,
} from "../shared/ipc";
import { loadImage } from "./load-image";

const host: HostEnvironment = {
  platform: process.platform,
  env: process.env,
  homedir: homedir(),
};

// Before anything touches it: keep Chromium's data out of ~/.config on Linux
// and out of the roaming profile on Windows.
app.setPath("userData", desktopStateDirectory(host));

// gh is looked for in this environment, which a launch from Finder, the
// Start menu or a desktop entry gives without the shell's PATH.
const core = createCore({
  github: (gh) => createGhAdapter({ runCommand, gh }),
  runCommand,
  host,
  settings: createSettingsFile(host),
  localState: createLocalStateFile(host),
});

wireContract(core);
// The renderer's one way to open a link, e.g. `o` on an issue.
ipcMain.on(ipcChannels.openExternal, (_event, url: unknown) => {
  if (typeof url === "string") openExternal(url);
});
ipcMain.handle(ipcChannels.chooseGhExecutable, (event) =>
  chooseGhExecutable(BrowserWindow.fromWebContents(event.sender)),
);
// An image from elsewhere than GitHub's media hosts, once the user asked.
ipcMain.handle(ipcChannels.loadImage, (_event, url: unknown) => loadImage(url));

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

/** Whether a renderer may make a request of this name. */
function isRequestName(name: unknown): name is keyof CoreRequests {
  return rendererRequestNames.includes(name as keyof CoreRequests);
}

/**
 * Lets the user choose gh in a file dialog, then has the core check and use
 * it. The renderer only asks for the dialog; it never names the file.
 */
async function chooseGhExecutable(
  window: BrowserWindow | null,
): ReturnType<DesktopApi["chooseGhExecutable"]> {
  const options: OpenDialogOptions = {
    title: "Choose gh executable",
    buttonLabel: "Choose",
    message: "Choose the gh executable, e.g. /opt/homebrew/bin/gh.",
    // Package managers put gh in folders Finder hides, such as /opt.
    properties: ["openFile", "showHiddenFiles"],
    ...(process.platform === "win32" && {
      filters: [
        { name: "Programs", extensions: ["exe"] },
        { name: "All files", extensions: ["*"] },
      ],
    }),
  };
  const { canceled, filePaths } = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const [file] = filePaths;
  if (canceled || file === undefined) return { status: "canceled" };
  return core.chooseGhExecutable(file);
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
