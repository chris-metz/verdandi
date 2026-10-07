import type { CoreEventName } from "@verdandi/core/contract";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  ipcChannels,
  rendererRequestNames,
  type DesktopApi,
  type RendererContract,
  type TabCommand,
} from "../shared/ipc";

const requests = Object.fromEntries(
  rendererRequestNames.map((name) => [
    name,
    (...args: unknown[]) => ipcRenderer.invoke(ipcChannels.request, name, args),
  ]),
);

// Built from the contract's own name lists, so every request and event the
// renderer may use is present; the cast only restores the per-name
// signatures.
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
} as RendererContract;

contextBridge.exposeInMainWorld("verdandi", api);

// Settings… may be chosen before the page listens, e.g. as the menu opens
// a window for it.
let settingsListener: (() => void) | undefined;
let settingsRequested = false;
ipcRenderer.on(ipcChannels.openSettings, () => {
  if (settingsListener) settingsListener();
  else settingsRequested = true;
});

const desktop: DesktopApi = {
  showSettingsFolder() {
    return ipcRenderer.invoke(ipcChannels.showSettingsFolder) as Promise<void>;
  },
  showConfigFile() {
    return ipcRenderer.invoke(ipcChannels.showConfigFile) as Promise<void>;
  },
  openConfigFile() {
    return ipcRenderer.invoke(ipcChannels.openConfigFile) as Promise<void>;
  },
  onOpenSettings(listener) {
    settingsListener = listener;
    if (settingsRequested) {
      settingsRequested = false;
      listener();
    }
    return () => {
      if (settingsListener === listener) settingsListener = undefined;
    };
  },
  onTabCommand(listener) {
    const forward = (_: IpcRendererEvent, command: TabCommand) => {
      listener(command);
    };
    ipcRenderer.on(ipcChannels.tabCommand, forward);
    return () => {
      ipcRenderer.removeListener(ipcChannels.tabCommand, forward);
    };
  },
  getSidebarHidden() {
    return ipcRenderer.invoke(ipcChannels.getSidebarHidden) as Promise<boolean>;
  },
  setSidebarHidden(hidden) {
    ipcRenderer.send(ipcChannels.setSidebarHidden, hidden);
  },
  onSidebarHiddenChanged(listener) {
    const forward = (_: IpcRendererEvent, hidden: boolean) => {
      listener(hidden);
    };
    ipcRenderer.on(ipcChannels.sidebarHiddenChanged, forward);
    return () => {
      ipcRenderer.removeListener(ipcChannels.sidebarHiddenChanged, forward);
    };
  },
  openExternal(url) {
    ipcRenderer.send(ipcChannels.openExternal, url);
  },
  chooseGhExecutable() {
    return ipcRenderer.invoke(ipcChannels.chooseGhExecutable) as ReturnType<
      DesktopApi["chooseGhExecutable"]
    >;
  },
  loadImage(url) {
    return ipcRenderer.invoke(ipcChannels.loadImage, url) as ReturnType<
      DesktopApi["loadImage"]
    >;
  },
  // Other Unix systems, which Electron does not ship for, count as Linux.
  platform:
    process.platform === "darwin" || process.platform === "win32"
      ? process.platform
      : "linux",
};

contextBridge.exposeInMainWorld("desktop", desktop);
