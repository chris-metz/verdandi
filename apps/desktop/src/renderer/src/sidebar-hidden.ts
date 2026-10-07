import { useSyncExternalStore } from "react";
import type { DesktopApi } from "../../shared/ipc";

/** Whether the sidebar is hidden, as main last said. */
let hidden = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(value: boolean) {
  hidden = value;
  for (const notify of listeners) notify();
}

/**
 * Follows whether the sidebar is hidden, as main keeps it: as it is now,
 * then as the View menu, its shortcut or the tab bar's button hide or show
 * it, until `stop` is called. A first read that a change overtook is
 * dropped. `ready` settles once the first read is in, or has failed, when
 * the sidebar shows.
 */
export function followSidebarHidden(
  desktop: Pick<DesktopApi, "getSidebarHidden" | "onSidebarHiddenChanged">,
): { ready: Promise<void>; stop: () => void } {
  let changed = false;
  let stopped = false;
  const unsubscribe = desktop.onSidebarHiddenChanged((value) => {
    changed = true;
    set(value);
  });
  const ready = desktop.getSidebarHidden().then(
    (value) => {
      if (!changed && !stopped) set(value);
    },
    () => undefined,
  );
  return {
    ready,
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
}

/** Whether the sidebar is hidden, as main last said. */
export function useSidebarHidden(): boolean {
  return useSyncExternalStore(subscribe, () => hidden);
}
