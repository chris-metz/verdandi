import type { Contract } from "@verdandi/core/contract";

declare global {
  interface Window {
    /** The core contract, exposed by preload. */
    verdandi: Contract;
  }
}
