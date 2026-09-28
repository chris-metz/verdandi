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
} as const;

/**
 * The contract requests the renderer cannot make. It chooses gh through
 * `DesktopApi.chooseGhExecutable` instead, so that it never names a file for
 * main to run: only the user does, in main's file dialog.
 */
const mainOnlyRequests = ["chooseGhExecutable"] as const;

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
  /** Opens a link in the browser, but only an `https://` one. */
  openExternal: (url: string) => void;
  /**
   * Lets the user choose the gh executable in a file dialog, then uses it if
   * it is a usable gh.
   */
  chooseGhExecutable: () => Promise<GhChoice | { status: "canceled" }>;
  /** The operating system, e.g. for ⌘ or Ctrl in shortcuts. */
  platform: Platform;
}

/** The operating systems Verdandi runs on, as Node names them. */
export type Platform = "darwin" | "win32" | "linux";
