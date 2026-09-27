import type { Contract } from "@verdandi/core/contract";
import type { DesktopApi } from "../../shared/ipc";

declare global {
  interface Window {
    /** The core contract, exposed by preload. */
    verdandi: Contract;
    /** What the desktop app offers besides the contract, exposed by preload. */
    desktop: DesktopApi;
  }
}
