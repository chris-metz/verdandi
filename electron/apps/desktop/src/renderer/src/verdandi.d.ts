import type { DesktopApi, RendererContract } from "../../shared/ipc";

declare global {
  interface Window {
    /** The core contract, as far as the renderer may use it, exposed by preload. */
    verdandi: RendererContract;
    /** What the desktop app offers besides the contract, exposed by preload. */
    desktop: DesktopApi;
    /**
     * The font faces installed, by the Local Font Access API, which
     * TypeScript's DOM types lack. It fails while the window is hidden.
     */
    queryLocalFonts?: () => Promise<readonly { family: string }[]>;
  }
}
