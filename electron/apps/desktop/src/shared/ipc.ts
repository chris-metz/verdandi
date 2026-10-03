import {
  requestNames,
  type Contract,
  type CoreRequests,
  type GhChoice,
} from "@verdandi/core/contract";

/** IPC channels between main and preload. */
export const ipcChannels = {
  /** Renderer → main: `(name, args)` of a contract request. */
  request: "verdandi:request",
  /** Main → renderer: `(name, payload)` of a pushed contract event. */
  event: "verdandi:event",
  /** Renderer → main: `(url)` to open in the browser, if it is `https://`. */
  openExternal: "desktop:open-external",
  /** Renderer → main: `()` to let the user choose gh in a file dialog. */
  chooseGhExecutable: "desktop:choose-gh-executable",
  /** Renderer → main: `(url)` of an image to load from elsewhere than GitHub. */
  loadImage: "desktop:load-image",
  showSettingsFolder: "desktop:show-settings-folder",
  showConfigFile: "desktop:show-config-file",
  /** Renderer → main: `()` to open config.toml in the default editor. */
  openConfigFile: "desktop:open-config-file",
  /** Main → renderer: `()` from the menu, to open the settings dialog. */
  openSettings: "desktop:open-settings",
  /** Main → renderer: `(command)` from the menu, for the tabs. */
  tabCommand: "desktop:tab-command",
  /** Renderer → main: `()` whether the sidebar is hidden. */
  getSidebarHidden: "desktop:get-sidebar-hidden",
  /** Renderer → main: `(hidden)` to hide or show the sidebar. */
  setSidebarHidden: "desktop:set-sidebar-hidden",
  /** Main → renderer: `(hidden)` whenever the sidebar is hidden or shown. */
  sidebarHiddenChanged: "desktop:sidebar-hidden-changed",
} as const;

/** What the File menu asks of the tabs, by its items' shortcuts too. */
export type TabCommand = "new-tab" | "close-tab" | "reopen-closed-tab";

/**
 * The contract requests the renderer cannot make. It chooses gh through
 * `DesktopApi.chooseGhExecutable` instead, so that it never names a file for
 * main to run: only the user does, in main's file dialog. Window geometry is
 * also captured and applied only by main, and whether the sidebar is hidden
 * kept by main, which shows it in the View menu.
 */
const mainOnlyRequests = [
  "chooseGhExecutable",
  "getWindowState",
  "saveWindowState",
  "getSidebarHidden",
  "saveSidebarHidden",
] as const;

/** The contract as the renderer reaches it. */
export type RendererContract = Omit<
  Contract,
  (typeof mainOnlyRequests)[number]
>;

/** Every request the renderer may make, for wiring it over IPC. */
export const rendererRequestNames = requestNames.filter(
  (name) =>
    !(mainOnlyRequests as readonly (keyof CoreRequests)[]).includes(name),
);

/**
 * What the desktop app offers the renderer besides the core contract. It is
 * not part of the contract: another interface opens links its own way.
 */
export interface DesktopApi {
  /** Reveals the user-data folder containing settings.json. */
  showSettingsFolder: () => Promise<void>;
  /**
   * Reveals config.toml in the file manager, or its folder, created if need
   * be, while there is no file.
   */
  showConfigFile: () => Promise<void>;
  /** Opens config.toml in the default editor for it, if there is a file. */
  openConfigFile: () => Promise<void>;
  /**
   * Calls `listener` whenever the menu's Settings… asks to open the settings
   * dialog, until the returned function is called. A request made before
   * there was a listener goes to the first one.
   */
  onOpenSettings: (listener: () => void) => () => void;
  /**
   * Calls `listener` whenever the menu's New Tab, Close Tab or Reopen Closed
   * Tab is chosen, by its shortcut too, until the returned function is
   * called.
   */
  onTabCommand: (listener: (command: TabCommand) => void) => () => void;
  /** Whether the sidebar is hidden, as the View menu says. */
  getSidebarHidden: () => Promise<boolean>;
  /**
   * Hides or shows the sidebar, as the View menu's item does, and keeps it
   * so on this machine.
   */
  setSidebarHidden: (hidden: boolean) => void;
  /**
   * Calls `listener` whenever the sidebar is hidden or shown, whichever way,
   * until the returned function is called.
   */
  onSidebarHiddenChanged: (listener: (hidden: boolean) => void) => () => void;
  /** Opens a link in the browser, but only an `https://` one. */
  openExternal: (url: string) => void;
  /**
   * Lets the user choose the gh executable in a file dialog, then uses it if
   * it is a usable gh.
   */
  chooseGhExecutable: () => Promise<GhChoice | { status: "canceled" }>;
  /**
   * Loads an image a body shows from elsewhere than GitHub's media hosts,
   * once the user asked: the window's Content Security Policy would not let
   * it load there. It is an `https://` one, fetched without credentials or
   * referrer, at most 10 MB.
   */
  loadImage: (url: string) => Promise<LoadedImage>;
  /** The operating system, e.g. for ⌘ or Ctrl in shortcuts. */
  platform: Platform;
}

/** An image loaded for the renderer, or why it could not be. */
export type LoadedImage =
  | { status: "loaded"; bytes: Uint8Array<ArrayBuffer>; type: string }
  | { status: "failed"; reason: string };

/** The operating systems Verdandi runs on, as Node names them. */
export type Platform = "darwin" | "win32" | "linux";
