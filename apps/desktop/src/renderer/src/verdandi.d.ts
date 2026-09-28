import type { DesktopApi, RendererContract } from "../../shared/ipc";

declare global {
  interface Window {
    /** The core contract, as far as the renderer may use it, exposed by preload. */
    verdandi: RendererContract;
    /** What the desktop app offers besides the contract, exposed by preload. */
    desktop: DesktopApi;
  }
}
