import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createCore,
  createGhAdapter,
  createLocalStateFile,
  createSettingsFile,
  desktopStateDirectory,
  runCommand,
  userDataDirectory,
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
  Menu,
  nativeTheme,
  shell,
  type OpenDialogOptions,
} from "electron";
import {
  ipcChannels,
  rendererRequestNames,
  type DesktopApi,
} from "../shared/ipc";
import { shownTheme } from "../shared/themes";
import icon from "../../build/icon.png?asset";
import { loadImage } from "./load-image";

const host: HostEnvironment = {
  platform: process.platform,
  env: process.env,
  homedir: homedir(),
};

// Before anything touches it: keep Chromium's data out of ~/.config on Linux
// and out of the roaming profile on Windows.
app.setPath("userData", desktopStateDirectory(host));

// Acquire before creating a core or touching portable user data.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
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
  let quitting = false;
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => {
    core.dispose();
  });
  let opening: Promise<void> | undefined;
  function openWindow() {
    opening ??= createWindow(core, () => {
      // A close delayed for its state write also delayed app.quit on macOS.
      if (quitting) app.quit();
    }).finally(() => {
      opening = undefined;
    });
    return opening;
  }
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    } else if (app.isReady()) void openWindow();
  });
  ipcMain.handle(ipcChannels.showSettingsFolder, showSettingsFolder);
  // The renderer's one way to open a link, e.g. `o` on an issue.
  ipcMain.on(ipcChannels.openExternal, (_event, url: unknown) => {
    if (typeof url === "string") openExternal(url);
  });
  ipcMain.handle(ipcChannels.chooseGhExecutable, (event) =>
    chooseGhExecutable(BrowserWindow.fromWebContents(event.sender)),
  );
  // An image from elsewhere than GitHub's media hosts, once the user asked.
  ipcMain.handle(ipcChannels.loadImage, (_event, url: unknown) =>
    loadImage(url),
  );

  void app.whenReady().then(() => {
    // A packaged app shows its bundle's icon; `pnpm dev` runs Electron's own.
    if (process.platform === "darwin" && !app.isPackaged) {
      app.dock?.setIcon(icon);
    }
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin"
          ? [{ role: "appMenu" as const }]
          : []),
        {
          label: "File",
          submenu: [
            {
              label: "Show Settings File",
              click: () => {
                void showSettingsFolder().catch((error: unknown) => {
                  dialog.showErrorBox(
                    "Cannot show settings folder",
                    error instanceof Error ? error.message : String(error),
                  );
                });
              },
            },
            { type: "separator" },
            { role: "close" },
          ],
        },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
    void openWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void openWindow();
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
}

async function createWindow(core: Contract, afterClose: () => void) {
  const saved = await core.getWindowState();
  const window = new BrowserWindow({
    ...(saved
      ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
      : { width: 1200, height: 800 }),
    show: false,
    title: "Verdandi",
    // macOS shows the app's icon instead; Linux shows no icon without it.
    ...(process.platform === "darwin" ? {} : { icon }),
    // The shown theme's background, so the window does not flash on opening.
    backgroundColor: shownTheme(nativeTheme.shouldUseDarkColors).colors
      .background,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.once("ready-to-show", () => {
    if (saved?.maximized) window.maximize();
    window.show();
  });

  let maximized = saved?.maximized ?? false;
  let closing = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function save() {
    return core
      .saveWindowState({ ...window.getNormalBounds(), maximized })
      .catch(() => undefined);
  }
  function changed() {
    clearTimeout(saveTimer);
    if (!closing)
      saveTimer = setTimeout(() => {
        void save();
      }, 200);
  }
  window.on("move", changed);
  window.on("resize", changed);
  window.on("maximize", () => {
    maximized = true;
    changed();
  });
  window.on("unmaximize", () => {
    maximized = false;
    changed();
  });
  window.on("close", (event) => {
    event.preventDefault();
    if (closing) return;
    closing = true;
    clearTimeout(saveTimer);
    void save().finally(() => {
      window.destroy();
      afterClose();
    });
  });
  window.on("closed", () => {
    clearTimeout(saveTimer);
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

/** The renderer cannot choose an arbitrary local path to open. */
async function showSettingsFolder() {
  const folder = userDataDirectory(host);
  await mkdir(folder, { recursive: true });
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
}
