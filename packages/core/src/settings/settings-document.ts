import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { createHash } from "node:crypto";
import { isObject } from "../json.ts";
import { parseRepositoryAddress } from "../repository-address.ts";

export interface SettingsDocument {
  version: number;
  repositories: { name: string; id?: number }[];
  views: { id: string; name: string; query: string }[];
  hosts: { id: string; name: string; address: string; folders: string[] }[];
}

/**
 * The newest version Verdandi knows: 2 has hosts, which version 1 does not.
 * A file says version 2 only while it holds hosts, so that a version of
 * Verdandi without them reads it without changing it, and every other file
 * stays as earlier versions wrote it.
 */
export const knownVersion = 2;

/** Strict known schema; future versions may carry fields this app cannot write. */
export function parseSettings(text: string): SettingsDocument {
  const errors: ParseError[] = [];
  const json: unknown = parse(text, errors, {
    disallowComments: true,
    allowTrailingComma: false,
    allowEmptyContent: false,
  });
  const error = errors[0];
  if (error) {
    const lines = text.slice(0, error.offset).split(/\r\n|\r|\n/);
    throw new Error(
      `not valid JSON: line ${String(lines.length)}, column ${String((lines.at(-1)?.length ?? 0) + 1)}: ${printParseErrorCode(error.error)}`,
    );
  }
  const root = object(json, "settings");
  if (!Number.isSafeInteger(root.version) || (root.version as number) < 0)
    throw new Error("version must be a non-negative integer.");
  const version = root.version as number;
  const strict = version <= knownVersion;
  fields(root, ["version", "repositories", "views", "hosts"], "", strict);
  const repositories = list(
    root.repositories === undefined ? [] : root.repositories,
    "repositories",
  ).map((value, index) => {
    const at = `repositories[${String(index)}]`;
    const entry = object(value, at);
    fields(entry, ["name", "id"], at, strict);
    if (typeof entry.name !== "string" || !parseRepositoryAddress(entry.name))
      throw new Error(`${at}.name is not "owner/name".`);
    if (
      entry.id !== undefined &&
      (!Number.isSafeInteger(entry.id) || (entry.id as number) <= 0)
    )
      throw new Error(`${at}.id must be a positive integer.`);
    return {
      name: entry.name,
      ...(entry.id === undefined ? {} : { id: entry.id as number }),
    };
  });
  const ids = new Set<string>();
  const views = list(root.views === undefined ? [] : root.views, "views").map(
    (value, index) => {
      const at = `views[${String(index)}]`;
      const entry = object(value, at);
      fields(entry, ["id", "name", "query"], at, strict);
      const name = string(entry.name, `${at}.name`);
      const query = string(entry.query, `${at}.query`);
      // Missing IDs stay stable between reads and are persisted on the next write.
      const id =
        entry.id === undefined
          ? createHash("sha256")
              .update(JSON.stringify([name, query, index]))
              .digest("hex")
              .slice(0, 12)
          : string(entry.id, `${at}.id`);
      if (ids.has(id)) throw new Error(`${at}.id is duplicated.`);
      ids.add(id);
      return { id, name, query };
    },
  );
  const hostIds = new Set<string>();
  const hosts = list(root.hosts === undefined ? [] : root.hosts, "hosts").map(
    (value, index) => {
      const at = `hosts[${String(index)}]`;
      const entry = object(value, at);
      fields(entry, ["id", "name", "address", "folders"], at, strict);
      const id = string(entry.id, `${at}.id`);
      if (hostIds.has(id)) throw new Error(`${at}.id is duplicated.`);
      hostIds.add(id);
      const folders = list(entry.folders, `${at}.folders`).map(
        (folder, place) => string(folder, `${at}.folders[${String(place)}]`),
      );
      if (folders.length === 0)
        throw new Error(`${at}.folders must name at least one folder.`);
      return {
        id,
        name: string(entry.name, `${at}.name`),
        address: string(entry.address, `${at}.address`),
        folders,
      };
    },
  );
  return { version, repositories, views, hosts };
}
function object(value: unknown, at: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${at} is not an object.`);
  return value;
}
function list(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${at} is not a list.`);
  return value;
}
function string(value: unknown, at: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${at} must be a non-empty string.`);
  return value;
}
function fields(
  value: Record<string, unknown>,
  allowed: string[],
  at: string,
  strict: boolean,
) {
  if (!strict) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      throw new Error(`${at ? `${at}.` : ""}${key} is an unknown field.`);
  }
}
