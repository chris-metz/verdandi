/** IPC channels that carry the core contract between main and preload. */
export const ipcChannels = {
  /** Renderer → main: `(name, args)` of a contract request. */
  request: "verdandi:request",
  /** Main → renderer: `(name, payload)` of a pushed contract event. */
  event: "verdandi:event",
} as const;
