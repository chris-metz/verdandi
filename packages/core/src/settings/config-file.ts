import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import type { ConfigState } from "../contract.ts";
import { configDirectory, type HostEnvironment } from "../directories.ts";
import { defaultConfig, readConfig } from "./config-document.ts";
import type { ConfigStorage, ThemeCatalogue } from "./port.ts";
import { watchFile } from "./watch-file.ts";

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

  async function read(): Promise<ConfigState> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" &&
        (await missing())
      )
        return {
          config: defaultConfig(catalogue),
          file,
          status: "missing",
          problems: [],
        };
      const reason = error instanceof Error ? error.message : String(error);
      return {
        config: defaultConfig(catalogue),
        file,
        status: "unreadable",
        problems: [
          {
            message: `Cannot read config.toml: ${reason.replace(/\.$/, "")}. Verdandi uses every default until it can.`,
          },
        ],
      };
    }
    return { ...readConfig(text, catalogue), file };
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
  };
}
