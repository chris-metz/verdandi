import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Watches a file through its folder, so that creating, deleting and an
 * editor's rename replacing the file are seen too. The folder is created if
 * need be; without `createFolder`, the nearest folder that exists is watched
 * instead until it appears. `changed` is called whenever the file's text, or
 * whether it can be read, differs from before, and when watching fails. Each
 * check runs through `serial`, after the reads and writes before it. `ready`
 * settles once watching has begun, so that a read after it sees every later
 * change.
 */
export function watchFile(
  folder: string,
  name: string,
  {
    serial,
    changed,
    createFolder = true,
  }: {
    serial: (action: () => Promise<void>) => Promise<void>;
    changed: () => void;
    createFolder?: boolean;
  },
): { ready: Promise<void>; close: () => void } {
  const file = join(folder, name);
  let closed = false;
  let observed: string | undefined;
  let watching: { close: () => void } | undefined;
  async function signature(): Promise<string> {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      return `Cannot read: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  /** Within `serial`: tells of a change since the last look. */
  async function compare() {
    // Before the first signature is read, the folder may report a write from
    // before watching began; that read sees any change.
    if (closed || observed === undefined) return;
    const previous = observed;
    observed = await signature();
    if (observed !== previous) changed();
  }
  /** Watches the folder, or the nearest one that exists on the way to it. */
  function follow(watched: string): Promise<void> {
    watching?.close();
    const next = watchFolder(watched, {
      changed(changedName) {
        if (watched === folder) {
          if (changedName === null || changedName === name)
            void serial(compare);
          return;
        }
        // The folder, or one on the way to it, may have appeared.
        void serial(async () => {
          if (closed) return;
          const nearest = await nearestFolder(folder);
          if (nearest === watched) return;
          await follow(nearest);
          await compare();
          // A new watcher on macOS misses what changes while it starts.
          setTimeout(() => void serial(compare), 250).unref();
        });
      },
      failed() {
        if (!closed) changed();
      },
    });
    watching = next;
    return next.started;
  }
  const ready = (
    createFolder
      ? mkdir(folder, { recursive: true }).then(() => folder)
      : nearestFolder(folder)
  )
    .then(async (watched) => {
      if (closed) return;
      await follow(watched);
      observed = await signature();
    })
    .catch(() => {
      if (!closed) changed();
    });
  return {
    ready,
    close() {
      closed = true;
      watching?.close();
    },
  };
}

/** The folder if it exists, or else the nearest one on the way to it. */
async function nearestFolder(folder: string): Promise<string> {
  for (let current = folder; ; current = dirname(current)) {
    try {
      if ((await stat(current)).isDirectory()) return current;
    } catch {
      // Not there (yet): its parent is looked at instead.
    }
    if (dirname(current) === current) return current;
  }
}

interface FolderListener {
  /** Something in the folder changed: the file of this name, if known. */
  changed(name: string | null): void;
  /** Watching stopped working. */
  failed(): void;
}

interface FolderWatch {
  listeners: Set<FolderListener>;
  started: Promise<FSWatcher | undefined>;
}

/**
 * One watcher per folder, however many files in it are watched. On macOS,
 * each new watcher restarts the process's one FSEvents stream, which misses
 * what changes meanwhile.
 */
const folders = new Map<string, FolderWatch>();

function watchFolder(
  folder: string,
  listener: FolderListener,
): { started: Promise<void>; close: () => void } {
  let entry = folders.get(folder);
  if (!entry) {
    const listeners = new Set<FolderListener>();
    const forget = () => {
      if (folders.get(folder) === created) folders.delete(folder);
    };
    const created: FolderWatch = {
      listeners,
      started: Promise.resolve()
        .then(() => {
          // Everyone stopped watching before it began.
          if (listeners.size === 0) return undefined;
          const watcher = watch(folder, { persistent: false }, (_, name) => {
            for (const each of listeners) each.changed(name);
          });
          watcher.on("error", () => {
            forget();
            for (const each of listeners) each.failed();
          });
          return watcher;
        })
        .catch((error: unknown) => {
          forget();
          throw error;
        }),
    };
    entry = created;
    folders.set(folder, entry);
  }
  const { listeners, started } = entry;
  listeners.add(listener);
  return {
    started: started.then(() => undefined),
    close() {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      if (folders.get(folder) === entry) folders.delete(folder);
      void started.then(
        (watcher) => watcher?.close(),
        () => undefined,
      );
    },
  };
}
