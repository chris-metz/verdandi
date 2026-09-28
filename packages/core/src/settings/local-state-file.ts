import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { desktopStateDirectory, type HostEnvironment } from "../directories.ts";
import { isObject } from "../json.ts";
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
      const { ghExecutable } = await readObject();
      return {
        ghExecutable:
          typeof ghExecutable === "string" && paths.isAbsolute(ghExecutable)
            ? ghExecutable
            : undefined,
      };
    },
    async update(change) {
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
    },
  };
}
