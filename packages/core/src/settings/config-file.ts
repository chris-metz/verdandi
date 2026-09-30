import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ConfigState } from "../contract.ts";
import { configDirectory, type HostEnvironment } from "../directories.ts";
import {
  changeConfigText,
  defaultConfig,
  readConfig,
} from "./config-document.ts";
import type { ConfigStorage, ThemeCatalogue } from "./port.ts";
import { watchFile } from "./watch-file.ts";
import { writeWhole } from "./write-whole.ts";

/**
 * `config.toml`, how Verdandi looks, which only the user and the settings
 * dialog write (ADR 0005). Verdandi never creates it only to read it.
 */
export function createConfigFile(
  host: HostEnvironment,
  catalogue: ThemeCatalogue,
): ConfigStorage {
  const paths = host.platform === "win32" ? path.win32 : path.posix;
  const folder = configDirectory(host);
  const file = paths.join(folder, "config.toml");
  let watching = Promise.resolve();
  let pending = Promise.resolve();
  // Reads in order, so that the last change read is the last one pushed.
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const result = pending.then(action);
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * The file's text, or none when there is no file at all, or why it cannot
   * be read.
   */
  async function readText(): Promise<
    { text: string | undefined } | { reason: string }
  > {
    try {
      return { text: await readFile(file, "utf8") };
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" &&
        (await missing())
      )
        return { text: undefined };
      return { reason: why(error) };
    }
  }

  async function read(): Promise<ConfigState> {
    const found = await readText();
    if ("reason" in found)
      return {
        config: defaultConfig(catalogue),
        file,
        status: "unreadable",
        problems: [
          {
            message: `Cannot read config.toml: ${found.reason}. Verdandi uses every default until it can.`,
          },
        ],
      };
    if (found.text === undefined)
      return {
        config: defaultConfig(catalogue),
        file,
        status: "missing",
        problems: [],
      };
    return { ...readConfig(found.text, catalogue), file };
  }

  /** Whether there is no file at all, not even a dangling link. */
  async function missing(): Promise<boolean> {
    try {
      await lstat(file);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
  }

  return {
    async read() {
      await watching;
      return serial(read);
    },
    watch(changed) {
      // The folder is the user's to create, e.g. as a link to their dotfiles.
      const watcher = watchFile(folder, "config.toml", {
        serial,
        changed,
        createFolder: false,
      });
      watching = watcher.ready;
      return watcher.close;
    },
    change(change) {
      // A change always starts from the file as it is now.
      return serial(async () => {
        const found = await readText();
        if ("reason" in found)
          return {
            ok: false,
            message: `Cannot read config.toml: ${found.reason}. Nothing is written to it until it can be.`,
          };
        const changed = changeConfigText(found.text, change, catalogue);
        if (!changed.ok) return changed;
        if (changed.text === found.text) return { ok: true };
        try {
          if (found.text === undefined) {
            // The first change creates the folder, which reading never does.
            await mkdir(folder, { recursive: true });
            await writeWhole(file, changed.text);
          } else {
            // A link, e.g. into the user's dotfiles, stays one, and the file
            // keeps who may read it.
            const target = await realpath(file);
            const { mode } = await stat(target);
            await writeWhole(target, changed.text, { mode: mode & 0o777 });
          }
        } catch (error) {
          return {
            ok: false,
            message: `Cannot write config.toml: ${why(error)}.`,
          };
        }
        return { ok: true };
      });
    },
  };
}

/** Why a file operation failed, without a closing full stop. */
function why(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(
    /\.$/,
    "",
  );
}
