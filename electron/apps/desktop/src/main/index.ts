import { lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  createConfigFile,
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
  type Config,
  type ConfigState,
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
  type MenuItemConstructorOptions,
  type OpenDialogOptions,
} from "electron";
import {
  ipcChannels,
  rendererRequestNames,
  type DesktopApi,
  type TabCommand,
} from "../shared/ipc";
import { fontDefaults } from "../shared/fonts";
import { shownTheme, themeCatalogue } from "../shared/themes";
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
    config: createConfigFile(host, themeCatalogue, fontDefaults),
  });

  // Native menus and dialogs, and the renderer's prefers-color-scheme, follow
  // the appearance; the renderer then shows the light or dark theme.
  let config: Config | undefined;
  function applyConfig(state: ConfigState) {
    config = state.config;
    nativeTheme.themeSource = state.config.appearance;
    showBackground();
  }
  /** The shown theme's background behind each window's page. */
  function showBackground() {
    for (const window of BrowserWindow.getAllWindows())
      window.setBackgroundColor(windowBackground(config));
  }
  // Before the renderer hears of a change, main applies it.
  core.on("configChanged", applyConfig);
  nativeTheme.on("updated", showBackground);
  wireContract(core);
  let quitting = false;
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => {
    core.dispose();
  });
  let opening: Promise<BrowserWindow> | undefined;
  function openWindow() {
    opening ??= createWindow(core, windowBackground(config), () => {
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
  ipcMain.handle(ipcChannels.showConfigFile, showConfigFile);
  ipcMain.handle(ipcChannels.openConfigFile, openConfigFile);
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

  // Whether the sidebar is hidden, on this machine: the View menu, its
  // shortcut and each window's button hide and show it, and the menu and
  // every window follow.
  let sidebarHidden = false;
  function setSidebarHidden(hidden: boolean) {
    if (hidden === sidebarHidden) return;
    sidebarHidden = hidden;
    showMenu();
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(ipcChannels.sidebarHiddenChanged, hidden);
    void core.saveSidebarHidden(hidden).catch(() => undefined);
  }
  ipcMain.handle(ipcChannels.getSidebarHidden, () => sidebarHidden);
  ipcMain.on(ipcChannels.setSidebarHidden, (_event, hidden: unknown) => {
    if (typeof hidden === "boolean") setSidebarHidden(hidden);
  });

  void app.whenReady().then(async () => {
    // A packaged app shows its bundle's icon; `pnpm dev` runs Electron's own.
    if (process.platform === "darwin" && !app.isPackaged) {
      app.dock?.setIcon(icon);
    }
    // The View menu names what its sidebar item does now.
    sidebarHidden = await core.getSidebarHidden();
    showMenu();
    // The window opens in the look config.toml sets.
    applyConfig(await core.getConfig());
    void openWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void openWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  /**
   * Sets the application menu, as it is now: its sidebar item names what it
   * does, hiding or showing the sidebar.
   */
  function showMenu() {
    const settings: MenuItemConstructorOptions = {
      label: "Settings…",
      accelerator: "CmdOrCtrl+,",
      click: () => {
        void openSettings();
      },
    };
    /** A File menu item for the tabs of the window in front. */
    const tabItem = (
      label: string,
      accelerator: string,
      command: TabCommand,
    ): MenuItemConstructorOptions => ({
      label,
      accelerator,
      click: () => {
        (
          BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        )?.webContents.send(ipcChannels.tabCommand, command);
      },
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin"
          ? [
              {
                label: app.name,
                submenu: [
                  { role: "about" },
                  { type: "separator" },
                  settings,
                  { type: "separator" },
                  { role: "services" },
                  { type: "separator" },
                  { role: "hide" },
                  { role: "hideOthers" },
                  { role: "unhide" },
                  { type: "separator" },
                  { role: "quit" },
                ],
              } satisfies MenuItemConstructorOptions,
            ]
          : []),
        {
          label: "File",
          submenu: [
            tabItem("New Tab", "CmdOrCtrl+T", "new-tab"),
            tabItem(
              "Reopen Closed Tab",
              "CmdOrCtrl+Shift+T",
              "reopen-closed-tab",
            ),
            { type: "separator" },
            ...(process.platform === "darwin"
              ? []
              : [settings, { type: "separator" as const }]),
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
            {
              label: "Show Config File",
              click: () => {
                void showConfigFile().catch((error: unknown) => {
                  dialog.showErrorBox(
                    "Cannot show config file",
                    error instanceof Error ? error.message : String(error),
                  );
                });
              },
            },
            { type: "separator" },
            // ⌘W closes a tab, never the window; the last leaves a new tab.
            tabItem("Close Tab", "CmdOrCtrl+W", "close-tab"),
            {
              role: "close",
              label: "Close Window",
              accelerator: "CmdOrCtrl+Shift+W",
            },
          ],
        },
        { role: "editMenu" },
        {
          label: "View",
          submenu: [
            {
              label: sidebarHidden ? "Show Sidebar" : "Hide Sidebar",
              accelerator:
                process.platform === "darwin" ? "Ctrl+Cmd+S" : "Ctrl+B",
              click: () => {
                setSidebarHidden(!sidebarHidden);
              },
            },
            { type: "separator" },
            // The items of Electron's own View menu.
            { role: "reload" },
            { role: "forceReload" },
            { role: "toggleDevTools" },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        // Elsewhere, the role's menu closes the window with Ctrl+W, which
        // closes a tab; Close Window is in the File menu.
        process.platform === "darwin"
          ? { role: "windowMenu" }
          : {
              label: "Window",
              submenu: [{ role: "minimize" }, { role: "zoom" }],
            },
      ]),
    );
  }

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

  /**
   * Opens the settings dialog in the window, opening one first if there is
   * none, e.g. on macOS once the last was closed.
   */
  async function openSettings() {
    const window =
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows()[0] ??
      (await openWindow());
    const send = () => {
      window.webContents.send(ipcChannels.openSettings);
    };
    if (window.webContents.isLoading())
      window.webContents.once("did-finish-load", send);
    else send();
    if (window.isMinimized()) window.restore();
    window.focus();
  }

  /** Opens config.toml in the default editor for it. */
  async function openConfigFile() {
    const { file, status } = await core.getConfig();
    if (status === "missing") throw new Error("There is no config.toml yet.");
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
  }

  /**
   * Reveals config.toml in the file manager, or, while there is none, the
   * folder it goes in.
   */
  async function showConfigFile() {
    const { file } = await core.getConfig();
    try {
      await lstat(file);
      shell.showItemInFolder(file);
      return;
    } catch {
      // Not there yet: the folder is shown instead.
    }
    const folder = dirname(file);
    await mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
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

async function createWindow(
  core: Contract,
  backgroundColor: string,
  afterClose: () => void,
) {
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
    backgroundColor,
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
  return window;
}

/** Opens a link in the browser, but only an `https://` one. */
function openExternal(url: string) {
  if (URL.parse(url)?.protocol === "https:") void shell.openExternal(url);
}

/** The background of the theme shown now, as the appearance says. */
function windowBackground(config: Config | undefined): string {
  return shownTheme(nativeTheme.shouldUseDarkColors, config).colors.background;
}

/** The renderer cannot choose an arbitrary local path to open. */
async function showSettingsFolder() {
  const folder = userDataDirectory(host);
  await mkdir(folder, { recursive: true });
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
}
