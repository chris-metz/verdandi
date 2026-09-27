/** IPC channels between main and preload. */
export const ipcChannels = {
  /** Renderer → main: `(name, args)` of a contract request. */
  request: "verdandi:request",
  /** Main → renderer: `(name, payload)` of a pushed contract event. */
  event: "verdandi:event",
  /** Renderer → main: `(url)` to open in the browser, if it is `https://`. */
  openExternal: "desktop:open-external",
} as const;

/**
 * What the desktop app offers the renderer besides the core contract. It is
 * not part of the contract: another interface opens links its own way.
 */
export interface DesktopApi {
  /** Opens a link in the browser, but only an `https://` one. */
  openExternal: (url: string) => void;
}
