import {
  requestNames,
  type Contract,
  type CoreEventName,
} from "@verdandi/core/contract";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { ipcChannels, type DesktopApi } from "../shared/ipc";

const requests = Object.fromEntries(
  requestNames.map((name) => [
    name,
    (...args: unknown[]) => ipcRenderer.invoke(ipcChannels.request, name, args),
  ]),
);

// Built from the contract's own name lists, so every request and event of the
// contract is present; the cast only restores the per-name signatures.
const api = {
  ...requests,
  on(event: CoreEventName, listener: (payload: unknown) => void) {
    const forward = (_: IpcRendererEvent, name: unknown, payload: unknown) => {
      if (name === event) listener(payload);
    };
    ipcRenderer.on(ipcChannels.event, forward);
    return () => {
      ipcRenderer.removeListener(ipcChannels.event, forward);
    };
  },
} as Contract;

contextBridge.exposeInMainWorld("verdandi", api);

const desktop: DesktopApi = {
  openExternal(url) {
    ipcRenderer.send(ipcChannels.openExternal, url);
  },
  // Other Unix systems, which Electron does not ship for, count as Linux.
  platform:
    process.platform === "darwin" || process.platform === "win32"
      ? process.platform
      : "linux",
};

contextBridge.exposeInMainWorld("desktop", desktop);
