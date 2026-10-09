/**
 * What the iOS app gives the core's host: plain functions on
 * `globalThis.__native`, implemented in Swift on JavaScriptCore. They take
 * and answer strings, numbers and booleans only. What finishes later is
 * answered by the app calling the host back (see `HostCallbacks`), with the
 * same ID.
 */
export interface Native {
  /** Writes a line to the app's log. */
  log(level: "debug" | "info" | "warn" | "error", message: string): void;
  /** Starts a timer; once it is due, the app calls `fireTimer(id)`. */
  startTimer(id: number, milliseconds: number): void;
  /** Stops a timer that has not fired yet. */
  cancelTimer(id: number): void;
  /** A random UUID, in lower case, as `crypto.randomUUID` gives one. */
  randomUUID(): string;
  /** The SHA-256 of a string's UTF-8 bytes, in lower-case hex. */
  sha256(text: string): string;
  /**
   * Runs one file operation at once, from `FileOperation`, its arguments
   * as JSON. It answers JSON: `{ "ok": true, "value": … }`, or `{ "ok":
   * false, "code": "ENOENT", "message": "…" }` with Node's error code.
   */
  fs(operation: FileOperation, argsJSON: string): string;
  /**
   * Starts watching a folder for changes to what it holds; the app then
   * calls `folderChanged(id)` for each. False when it cannot be watched,
   * e.g. as it does not exist.
   */
  watchFolder(id: number, path: string): boolean;
  /** Stops watching a folder. */
  unwatchFolder(id: number): void;
  /**
   * Sends one request to GitHub's API with the token the app keeps, the
   * request as JSON (`GitHubRequest`); the app calls `githubAnswered(id,
   * json)` with a `GitHubOutcome`. The token never reaches the host.
   */
  github(id: number, requestJSON: string): void;
  /**
   * Where the app's token comes from: the Keychain (`stored`), or
   * `GH_TOKEN` set where the app was launched, e.g. by a development
   * script; empty when there is none.
   */
  tokenSource(): string;
  /** Pushes one of the core's events, its payload as JSON. */
  emit(name: string, payloadJSON: string): void;
  /**
   * Answers a request the app made through `request`: its value as JSON,
   * or why it failed, as JSON `{ "message": "…" }`.
   */
  respond(id: number, ok: boolean, payloadJSON: string): void;
}

/** The file operations the host's `node:fs` stand-in asks the app for. */
export type FileOperation =
  | "readFile"
  | "writeFile"
  | "rename"
  | "rm"
  | "lstat"
  | "stat"
  | "mkdir"
  | "realpath";

/** One request to GitHub's API, relative to `https://api.github.com/`. */
export interface GitHubRequest {
  method: "GET" | "POST";
  /** The path, e.g. `graphql` or `search/issues`, without a leading slash. */
  path: string;
  /** Query parameters, in order; the app encodes them. */
  query: [string, string][];
  /** The body, for a POST. */
  body?: string;
}

/** What became of a request to GitHub's API. */
export type GitHubOutcome =
  /** GitHub answered, with any status. */
  | {
      kind: "response";
      status: number;
      headers: [string, string][];
      body: string;
    }
  /** The app has no token. */
  | { kind: "signed-out" }
  /** GitHub could not be reached, e.g. without a connection. */
  | { kind: "unreachable"; message: string };

/** The functions the app calls on `globalThis.__host`. */
export interface HostCallbacks {
  fireTimer(id: number): void;
  folderChanged(id: number): void;
  githubAnswered(id: number, outcomeJSON: string): void;
}

let current: Native | undefined;

/** Uses these native functions from now on; tests pass fakes. */
export function useNative(native: Native) {
  current = native;
}

/** The native functions in use. */
export function native(): Native {
  if (!current) throw new Error("The native functions are not set.");
  return current;
}
