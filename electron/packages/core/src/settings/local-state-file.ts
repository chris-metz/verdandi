import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { desktopStateDirectory, type HostEnvironment } from "../directories.ts";
import { isObject } from "../json.ts";
import { parseRepositoryAddress } from "../repository-address.ts";
import type { LocalState, LocalStateStorage } from "./port.ts";

/**
 * The machine-local-state port backed by `state.json` in the desktop state
 * directory. Whatever cannot be read in it is ignored, and replaced by the
 * next change.
 */
export function createLocalStateFile(host: HostEnvironment): LocalStateStorage {
  const paths = host.platform === "win32" ? path.win32 : path.posix;
  const directory = desktopStateDirectory(host);
  const file = paths.join(directory, "state.json");
  let pending = Promise.resolve();

  /** The file's top-level object, or none if it cannot be read. */
  async function readObject(): Promise<Record<string, unknown>> {
    try {
      const json: unknown = JSON.parse(await readFile(file, "utf8"));
      return isObject(json) ? json : {};
    } catch {
      return {};
    }
  }

  return {
    async read(): Promise<LocalState> {
      await pending;
      const { ghExecutable, window, selectedEntry } = await readObject();
      return {
        selectedEntry: readSelectedEntry(selectedEntry),
        window: readWindowState(window),
        ghExecutable:
          typeof ghExecutable === "string" && paths.isAbsolute(ghExecutable)
            ? ghExecutable
            : undefined,
      };
    },
    update(change) {
      const result = pending.then(async () =>
        update(typeof change === "function" ? await change() : change),
      );
      // A failed write must not prevent later changes from being saved.
      pending = result.catch(() => undefined);
      return result;
    },
  };

  async function update(change: Partial<LocalState>) {
    // Values it does not know stay, for other versions of Verdandi.
    const state = { ...(await readObject()), ...change };
    await mkdir(directory, { recursive: true });
    // Written whole, then renamed over the file, so that it is never half
    // written.
    const temporary = paths.join(directory, `.state.${randomUUID()}.json`);
    try {
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

function readSelectedEntry(value: unknown): LocalState["selectedEntry"] {
  if (!isObject(value)) return undefined;
  if (value.kind === "all") return { kind: "all" };
  if (value.kind === "view" && typeof value.id === "string" && value.id.trim())
    return { kind: "view", id: value.id };
  if (value.kind === "repository" && "id" in value)
    return Number.isSafeInteger(value.id) && (value.id as number) > 0
      ? { kind: "repository", id: value.id as number }
      : undefined;
  if (
    value.kind === "repository" &&
    typeof value.name === "string" &&
    parseRepositoryAddress(value.name)
  )
    return { kind: "repository", name: value.name };
  return undefined;
}

function readWindowState(value: unknown): LocalState["window"] {
  if (
    !isObject(value) ||
    !Number.isSafeInteger(value.x) ||
    !Number.isSafeInteger(value.y) ||
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    (value.width as number) <= 0 ||
    (value.height as number) <= 0 ||
    typeof value.maximized !== "boolean"
  )
    return undefined;
  return {
    x: value.x as number,
    y: value.y as number,
    width: value.width as number,
    height: value.height as number,
    maximized: value.maximized,
  };
}
