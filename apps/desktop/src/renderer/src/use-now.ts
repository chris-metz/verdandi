import { useSyncExternalStore } from "react";

/** How often the time is brought up to date. */
const tick = 30 * 1000;

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

/** One timer for everything that shows the time, while anything does. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, tick);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/**
 * The time, brought up to date every half minute, e.g. for an age a header
 * or a row shows.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}
