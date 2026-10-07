import { textSizes } from "@verdandi/core/contract";
import { useSyncExternalStore } from "react";
import type { RendererContract } from "../../shared/ipc";
import { followConfig } from "./config";

/**
 * The size of body text the stylesheets and the blocking map give their
 * sizes for, in pixels, which the text size scales.
 */
export const baseTextSize = 14;

/** The text size last shown, for `useTextSize`, and who it tells of a change. */
let shown: number = textSizes.default;
const listeners = new Set<() => void>();

/**
 * Shows text of `size` pixels on the page: `root` gets `--text-scale`, the
 * size over `baseTextSize`, which `index.css` multiplies into every text
 * size.
 */
export function showTextSize(root: HTMLElement, size: number) {
  root.style.setProperty("--text-scale", String(size / baseTextSize));
  if (size === shown) return;
  shown = size;
  for (const listener of listeners) listener();
}

/**
 * Shows the chosen text size, and switches it whenever it changes, until
 * `stop` is called. `ready` settles once `config.toml` is read; until then,
 * and if it cannot be, the default shows.
 */
export function followTextSize(
  root: HTMLElement,
  verdandi: Pick<RendererContract, "getConfig" | "on">,
): { ready: Promise<void>; stop: () => void } {
  return followConfig(verdandi, (state) => {
    showTextSize(root, state.config.textSize);
  });
}

/**
 * The text size shown, in pixels, for what lays itself out in pixels rather
 * than in CSS, such as the blocking map.
 */
export function useTextSize(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => shown,
  );
}
