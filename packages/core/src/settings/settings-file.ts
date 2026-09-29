import { watch } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { SidebarDestination, SidebarEntryKey } from "../contract.ts";
import { userDataDirectory, type HostEnvironment } from "../directories.ts";
import {
  parseSettings,
  type SettingsDocument as Document,
} from "./settings-document.ts";
import {
  nameWithOwner,
  parseRepositoryAddress,
} from "../repository-address.ts";
import type {
  RepositoryDuplicate,
  RepositoryUpdate,
  Settings,
  SettingsResult,
  SettingsStorage,
} from "./port.ts";

/** Portable user data. A change always starts from the file as it is now. */
export function createSettingsFile(
  host: HostEnvironment,
  { rename: renameFile = rename }: { rename?: typeof rename } = {},
): SettingsStorage {
  const paths = host.platform === "win32" ? path.win32 : path.posix;
  const folder = userDataDirectory(host);
  const file = paths.join(folder, "settings.json");
  let watching = Promise.resolve();
  let pending = Promise.resolve();
  // Serialize this instance's reads and changes; other writers need no lock.
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const result = pending.then(action);
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  let lastValid: Settings = { repositories: [], views: [] };
  async function readDocument(): Promise<{
    document: Document;
    text: string | undefined;
  }> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" &&
        (await missing())
      )
        return {
          document: { version: 1, repositories: [], views: [] },
          text: undefined,
        };
      throw new Error(`Cannot read ${file}: ${message(error)}`, {
        cause: error,
      });
    }
    try {
      return { document: parseSettings(text), text };
    } catch (error) {
      throw new Error(`${file}: ${message(error)}`, { cause: error });
    }
  }

  async function missing(): Promise<boolean> {
    try {
      await lstat(file);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
  }

  async function signature(): Promise<string> {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      return `Cannot read: ${message(error)}`;
    }
  }

  /** Windows virus scanners and sync clients briefly hold files open. */
  async function replace(from: string, to: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        await renameFile(from, to);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
      }
    }
  }

  async function writeDocument(document: Document) {
    await mkdir(folder, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      await replace(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  return {
    watch(changed) {
      let closed = false;
      let observed: string | undefined;
      let watcher: ReturnType<typeof watch> | undefined;
      watching = mkdir(folder, { recursive: true })
        .then(async () => {
          if (closed) return;
          watcher = watch(folder, { persistent: false }, (_event, name) => {
            if (name !== null && name !== "settings.json") return;
            void serial(async () => {
              // Before the first signature is read, the folder may report a
              // write from before watching began; that read sees any change.
              if (closed || observed === undefined) return;
              const previous = observed;
              observed = await signature();
              if (observed !== previous) changed();
            });
          });
          watcher.on("error", changed);
          observed = await signature();
        })
        .catch(() => {
          if (!closed) changed();
        });
      return () => {
        closed = true;
        watcher?.close();
      };
    },
    async read(): Promise<SettingsResult> {
      await watching;
      return serial(async () => {
        try {
          const { document, text } = await readDocument();
          const { kept, duplicates } = distinctIds(document.repositories);
          lastValid = {
            repositories: kept.flatMap(({ name, id }) => {
              const address = parseRepositoryAddress(name);
              return address
                ? [{ ...address, ...(id === undefined ? {} : { id }) }]
                : [];
            }),
            views: document.views,
          };
          return {
            ok: true,
            value: lastValid,
            status:
              document.version > 1
                ? { status: "newer-version", message: newerVersion }
                : { status: "writable" },
            exists: text !== undefined,
            duplicates,
          };
        } catch (error) {
          return { ok: false, message: message(error), value: lastValid };
        }
      });
    },
    reset() {
      return serial(async () => {
        try {
          // Reset is only a recovery action, never a way around read-only versions.
          let text: string | undefined;
          try {
            text = await readFile(file, "utf8");
          } catch (error) {
            if (
              (error as NodeJS.ErrnoException).code === "ENOENT" &&
              (await missing())
            )
              return {
                ok: false as const,
                message: "settings.json is gone. Reload to start empty.",
              };
          }
          if (text !== undefined) {
            try {
              const json: unknown = JSON.parse(text);
              if (
                typeof json === "object" &&
                json !== null &&
                "version" in json &&
                typeof json.version === "number" &&
                json.version > 1
              )
                return { ok: false as const, message: newerVersion };
            } catch {
              /* Invalid JSON is precisely what Reset can recover. */
            }
            try {
              parseSettings(text);
              return {
                ok: false as const,
                message: "settings.json is valid again. Reload to use it.",
              };
            } catch {
              /* Preserve the invalid file before starting empty. */
            }
          }
          const stamp = new Date().toISOString().replaceAll(":", "-");
          await replace(
            file,
            `${file}.broken-${stamp}-${randomUUID().slice(0, 8)}`,
          );
          await writeDocument({ version: 1, repositories: [], views: [] });
          lastValid = { repositories: [], views: [] };
          return { ok: true as const };
        } catch (error) {
          return { ok: false as const, message: message(error) };
        }
      });
    },
    reorder(entry, destination) {
      return change((document) => {
        // Before ordering, the higher duplicate without a GitHub ID wins.
        const names = new Set<string>();
        document.repositories = document.repositories.filter((repository) => {
          if (repository.id !== undefined) return true;
          const name = repository.name.toLowerCase();
          if (names.has(name)) return false;
          names.add(name);
          return true;
        });
        move(document, entry, destination);
      });
    },
    addRepositories(repositories) {
      return change((document) => {
        for (const repository of repositories) {
          const name = nameWithOwner(repository);
          const entry =
            document.repositories.find(({ id }) => id === repository.id) ??
            document.repositories.find(
              (other) =>
                other.id === undefined &&
                other.name.toLowerCase() === name.toLowerCase(),
            );
          if (entry) {
            entry.name = name;
            entry.id = repository.id;
          } else document.repositories.push({ name, id: repository.id });
        }
      });
    },
    async updateRepositories(updates) {
      const updated: RepositoryUpdate[] = [];
      const result = await change((document) => {
        for (const update of updates) {
          const { entry, current } = update;
          const name = nameWithOwner(entry).toLowerCase();
          const found =
            entry.id === undefined
              ? document.repositories.find(
                  (other) =>
                    other.id === undefined && other.name.toLowerCase() === name,
                )
              : document.repositories.find(({ id }) => id === entry.id);
          if (!found) continue;
          found.name = nameWithOwner(current);
          found.id = current.id;
          updated.push(update);
        }
        document.repositories = distinctIds(document.repositories).kept;
      });
      return result.ok ? { ok: true, updated } : result;
    },
    async removeDuplicateRepositories() {
      let removed: RepositoryDuplicate[] = [];
      const result = await change((document) => {
        const { kept, duplicates } = distinctIds(document.repositories);
        document.repositories = kept;
        removed = duplicates;
      });
      return result.ok ? { ok: true, removed } : result;
    },
    removeRepository(repository) {
      return change((document) => {
        const name = nameWithOwner(repository).toLowerCase();
        document.repositories = document.repositories.filter((entry) =>
          repository.id !== undefined
            ? entry.id !== repository.id
            : entry.id !== undefined || entry.name.toLowerCase() !== name,
        );
      });
    },
    saveView(view, after) {
      return change((document) => {
        const entry = document.views.find(({ id }) => id === view.id);
        if (entry) {
          entry.name = view.name;
          entry.query = view.query;
          return;
        }
        const index = document.views.findIndex(({ id }) => id === after);
        if (index < 0) document.views.push({ ...view });
        else document.views.splice(index + 1, 0, { ...view });
      });
    },
    removeView(id) {
      return change((document) => {
        document.views = document.views.filter((view) => view.id !== id);
      });
    },
    createIfMissing() {
      return serial(async () => {
        const empty: Document = { version: 1, repositories: [], views: [] };
        try {
          await mkdir(folder, { recursive: true });
          // Created only if missing, even when another writer races it.
          await writeFile(file, `${JSON.stringify(empty, null, 2)}\n`, {
            flag: "wx",
            mode: 0o600,
          });
          return { ok: true as const };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST")
            return { ok: true as const };
          return { ok: false as const, message: message(error) };
        }
      });
    },
  };

  /**
   * Applies one change to the file as it is now and writes it, migrating an
   * older version with a one-time backup. A missing file starts empty; a
   * newer version is never written.
   */
  function change(apply: (document: Document) => void) {
    return serial(async () => {
      try {
        const { document, text } = await readDocument();
        if (document.version > 1) throw new Error(newerVersion);
        apply(document);
        if (document.version < 1 && text !== undefined) {
          try {
            await writeFile(
              `${file}.backup-v${String(document.version)}`,
              text,
              { flag: "wx", mode: 0o600 },
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          }
        }
        document.version = 1;
        await writeDocument(document);
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, message: message(error) };
      }
    });
  }
}

/**
 * The entries without those that have the ID of one higher in the sidebar,
 * which is the repository's, and those left out.
 */
function distinctIds(repositories: Document["repositories"]): {
  kept: Document["repositories"];
  duplicates: RepositoryDuplicate[];
} {
  const first = new Map<number, string>();
  const duplicates: RepositoryDuplicate[] = [];
  const kept = repositories.filter(({ name, id }) => {
    if (id === undefined) return true;
    const sameAs = first.get(id);
    if (sameAs === undefined) {
      first.set(id, name);
      return true;
    }
    const repository = parseRepositoryAddress(name);
    const higher = parseRepositoryAddress(sameAs);
    if (repository && higher) duplicates.push({ repository, sameAs: higher });
    return false;
  });
  return { kept, duplicates };
}

function move(
  document: Document,
  entry: SidebarEntryKey,
  destination: SidebarDestination,
) {
  const section: (
    Document["repositories"][number] | Document["views"][number]
  )[] = entry.kind === "repository" ? document.repositories : document.views;
  const indexOf = (key: SidebarEntryKey) =>
    section.findIndex((item) =>
      key.kind === "repository"
        ? item.name.toLowerCase() ===
          nameWithOwner(key.repository).toLowerCase()
        : item.id === key.id,
    );
  const index = indexOf(entry);
  if (index < 0)
    throw new Error(
      "The sidebar entry is no longer in settings.json. Reload and try again.",
    );
  let target: number;
  if ("direction" in destination)
    target = index + (destination.direction === "up" ? -1 : 1);
  else {
    if (entry.kind !== destination.relativeTo.kind)
      throw new Error("Entries can only move within their section.");
    target = indexOf(destination.relativeTo);
    if (target < 0)
      throw new Error(
        "The destination is no longer in settings.json. Reload and try again.",
      );
    if (target === index) return;
    if (destination.side === "after") target++;
    if (index < target) target--;
  }
  if (target < 0 || target >= section.length) return;
  const [item] = section.splice(index, 1);
  if (item) section.splice(target, 0, item);
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const newerVersion =
  "settings.json was written by a newer version. Update Verdandi to change repositories or views.";
