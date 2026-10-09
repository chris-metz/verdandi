/**
 * `node:fs` for the iOS host: only `watch`, on a folder, which the core's
 * settings files use to see changes made outside the core.
 */
import { native } from "../native.ts";
import { FileSystemError } from "./fs-promises.ts";

type WatchListener = (event: "change" | "rename", name: string | null) => void;

/** A folder being watched, as Node's `FSWatcher` is used. */
export interface FSWatcher {
  on(event: "error", listener: (error: Error) => void): FSWatcher;
  close(): void;
}

let nextWatch = 1;
const watching = new Map<number, WatchListener>();

/** Watches a folder; throws at once when it cannot be watched, as Node does. */
export function watch(
  folder: string,
  options: unknown,
  listener: WatchListener,
): FSWatcher {
  const id = nextWatch++;
  if (!native().watchFolder(id, folder))
    throw new FileSystemError(
      "ENOENT",
      `ENOENT: no such file or directory, watch '${folder}'`,
    );
  watching.set(id, listener);
  const watcher: FSWatcher = {
    on() {
      // Watching a folder that is there never fails later on iOS.
      return watcher;
    },
    close() {
      if (watching.delete(id)) native().unwatchFolder(id);
    },
  };
  return watcher;
}

/** Called by the app when something in a watched folder changed. */
export function folderChanged(id: number) {
  // iOS does not say which file changed: every file in it is looked at.
  watching.get(id)?.("change", null);
}

export default { watch };
