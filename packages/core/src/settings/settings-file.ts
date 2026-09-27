import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RepositoryAddress } from "../contract.ts";
import { userDataDirectory, type HostEnvironment } from "../directories.ts";
import type { Settings, SettingsResult, SettingsStorage } from "./port.ts";

/**
 * The settings-storage port backed by `settings.json` in the user data
 * directory, which the user may also edit by hand.
 */
export function createSettingsFile(host: HostEnvironment): SettingsStorage {
  const paths = host.platform === "win32" ? path.win32 : path.posix;
  const file = paths.join(userDataDirectory(host), "settings.json");

  return {
    async read(): Promise<SettingsResult> {
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { ok: true, value: { repositories: [] } };
        }
        const reason = error instanceof Error ? error.message : String(error);
        return { ok: false, message: `Cannot read ${file}: ${reason}` };
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { ok: false, message: `${file} is not valid JSON: ${reason}` };
      }
      const settings = readSettings(json);
      if (typeof settings === "string") {
        return { ok: false, message: `${file}: ${settings}` };
      }
      return { ok: true, value: settings };
    },
  };
}

/**
 * Reads the settings from the parsed file, or says what makes them unusable.
 * Only what the core relies on is checked; `version`, repository ids, views
 * and unknown fields are not validated yet.
 */
function readSettings(json: unknown): Settings | string {
  if (!isObject(json)) return "the top level is not a JSON object.";
  const { repositories = [] } = json;
  if (!Array.isArray(repositories)) return "repositories is not a list.";
  const addresses: RepositoryAddress[] = [];
  for (const [index, entry] of repositories.entries()) {
    const address =
      isObject(entry) && typeof entry.name === "string"
        ? parseAddress(entry.name)
        : undefined;
    if (!address) {
      return `repositories[${String(index)}].name is not "owner/name".`;
    }
    addresses.push(address);
  }
  return { repositories: addresses };
}

/** Splits `owner/name`, if it is one. */
function parseAddress(nameWithOwner: string): RepositoryAddress | undefined {
  const [owner, name, ...rest] = nameWithOwner.split("/");
  if (!owner || !name || rest.length > 0) return undefined;
  return { owner, name };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
