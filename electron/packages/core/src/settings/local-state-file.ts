import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { desktopStateDirectory, type HostEnvironment } from "../directories.ts";
import { isObject } from "../json.ts";
import { parseRepositoryAddress } from "../repository-address.ts";
import type { RecentIssue, TabIssue } from "../contract.ts";
import type { LocalState, LocalStateStorage, StoredTab } from "./port.ts";

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

  /** The state the file holds, as far as it can be read. */
  async function readState(): Promise<LocalState> {
    const { ghExecutable, window, selectedEntry, tabs, recentIssues } =
      await readObject();
    return {
      selectedEntry: readStoredEntry(selectedEntry),
      tabs: readTabs(tabs),
      recentIssues: readRecentIssues(recentIssues),
      window: readWindowState(window),
      ghExecutable:
        typeof ghExecutable === "string" && paths.isAbsolute(ghExecutable)
          ? ghExecutable
          : undefined,
    };
  }

  return {
    async read(): Promise<LocalState> {
      await pending;
      return readState();
    },
    update(change) {
      const result = pending.then(async () =>
        update(
          typeof change === "function"
            ? await change(await readState())
            : change,
        ),
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

function readStoredEntry(value: unknown): LocalState["selectedEntry"] {
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

/**
 * The tabs, leaving out each tab and issue page that cannot be read; none if
 * no tab can be.
 */
function readTabs(value: unknown): LocalState["tabs"] {
  if (!isObject(value) || !Array.isArray(value.tabs)) return undefined;
  const tabs = value.tabs.flatMap((tab: unknown) => {
    const read = readTab(tab);
    return read ? [read] : [];
  });
  if (tabs.length === 0) return undefined;
  const shown = Number.isSafeInteger(value.shown) ? (value.shown as number) : 0;
  return { tabs, shown: Math.min(Math.max(shown, 0), tabs.length - 1) };
}

function readTab(value: unknown): StoredTab | undefined {
  if (!isObject(value)) return undefined;
  if (value.kind === "new") {
    const from = readStoredEntry(value.from);
    return {
      kind: "new",
      from: from?.kind === "repository" ? from : undefined,
    };
  }
  const entry = readStoredEntry(value.entry);
  if (value.kind !== "entry" || !entry) return undefined;
  const issues = Array.isArray(value.issues)
    ? value.issues.flatMap((issue: unknown) => {
        const read = readTabIssue(issue);
        return read ? [read] : [];
      })
    : [];
  return { kind: "entry", entry, issues };
}

function readTabIssue(value: unknown): TabIssue | undefined {
  if (
    !isObject(value) ||
    !isText(value.id) ||
    !isText(value.reference) ||
    typeof value.title !== "string"
  )
    return undefined;
  return {
    id: value.id,
    reference: value.reference,
    title: value.title,
    ...(typeof value.url === "string" ? { url: value.url } : {}),
  };
}

/** The recent issues, each once, leaving out those that cannot be read. */
function readRecentIssues(value: unknown): LocalState["recentIssues"] {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  return value.flatMap((issue: unknown) => {
    const read = readRecentIssue(issue);
    if (!read || seen.has(read.id)) return [];
    seen.add(read.id);
    return [read];
  });
}

function readRecentIssue(value: unknown): RecentIssue | undefined {
  if (
    !isObject(value) ||
    !isText(value.id) ||
    !isObject(value.repository) ||
    !isText(value.repository.owner) ||
    !isText(value.repository.name) ||
    !Number.isSafeInteger(value.number) ||
    (value.number as number) < 1 ||
    typeof value.title !== "string"
  )
    return undefined;
  return {
    id: value.id,
    repository: { owner: value.repository.owner, name: value.repository.name },
    number: value.number as number,
    title: value.title,
  };
}

/** Whether a value is a string with more than spaces in it. */
function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
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
