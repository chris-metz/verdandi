/**
 * The app's native functions for tests: files in memory, timers on Node's
 * own, and GitHub answered by a function the test gives.
 */
import { createHash, randomUUID } from "crypto";
import type {
  FileOperation,
  GitHubOutcome,
  GitHubRequest,
  Native,
} from "../native.ts";
import type { Host } from "../host.ts";

type Entry =
  { type: "file"; text: string; mode: number } | { type: "directory" };

export interface FakeNative extends Native {
  /** The files and folders, by absolute path. */
  files: Map<string, Entry>;
  /** The events the core pushed, in order. */
  events: { name: string; payload: unknown }[];
  /** The requests sent to GitHub, in order. */
  requests: GitHubRequest[];
  /** Connects the host the fake answers to. */
  attach(host: Host): void;
  /** Makes a request of the host and waits for its answer. */
  request<T>(name: string, ...args: unknown[]): Promise<T>;
}

export function createFakeNative({
  github,
  tokenSource = "stored",
}: {
  github: (request: GitHubRequest) => GitHubOutcome;
  tokenSource?: string;
}): FakeNative {
  const files = new Map<string, Entry>([["/", { type: "directory" }]]);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const answers = new Map<number, (ok: boolean, json: string) => void>();
  let host: Host | undefined;
  let nextRequest = 1;

  const parentOf = (path: string) => path.replace(/\/[^/]+$/, "") || "/";
  const fail = (code: string, message: string) => ({
    ok: false,
    code,
    message,
  });
  function operate(operation: FileOperation, args: unknown[]): unknown {
    const [path] = args as [string];
    switch (operation) {
      case "readFile": {
        const entry = files.get(path);
        if (entry?.type !== "file")
          return fail(
            "ENOENT",
            `ENOENT: no such file or directory, open '${path}'`,
          );
        return { ok: true, value: entry.text };
      }
      case "writeFile": {
        const [, text, flag, mode] = args as [
          string,
          string,
          string,
          number | null,
        ];
        if (files.get(parentOf(path))?.type !== "directory")
          return fail(
            "ENOENT",
            `ENOENT: no such file or directory, open '${path}'`,
          );
        if (flag === "wx" && files.has(path))
          return fail("EEXIST", `EEXIST: file already exists, open '${path}'`);
        files.set(path, { type: "file", text, mode: mode ?? 0o644 });
        return { ok: true, value: null };
      }
      case "rename": {
        const [, to] = args as [string, string];
        const entry = files.get(path);
        if (!entry)
          return fail(
            "ENOENT",
            `ENOENT: no such file or directory, rename '${path}'`,
          );
        files.delete(path);
        files.set(to, entry);
        return { ok: true, value: null };
      }
      case "rm": {
        const [, force] = args as [string, boolean];
        if (!files.delete(path) && !force)
          return fail(
            "ENOENT",
            `ENOENT: no such file or directory, rm '${path}'`,
          );
        return { ok: true, value: null };
      }
      case "lstat":
      case "stat": {
        const entry = files.get(path);
        if (!entry)
          return fail(
            "ENOENT",
            `ENOENT: no such file or directory, stat '${path}'`,
          );
        return {
          ok: true,
          value:
            entry.type === "file"
              ? {
                  type: "file",
                  mode: 0o100000 | entry.mode,
                  size: entry.text.length,
                }
              : { type: "directory", mode: 0o40755, size: 0 },
        };
      }
      case "mkdir": {
        const [, recursive] = args as [string, boolean];
        const missing: string[] = [];
        for (let at = path; !files.has(at); at = parentOf(at))
          missing.unshift(at);
        if (missing.length > 1 && !recursive)
          return fail(
            "ENOENT",
            `ENOENT: no such file or directory, mkdir '${path}'`,
          );
        for (const folder of missing) files.set(folder, { type: "directory" });
        return { ok: true, value: null };
      }
      case "realpath":
        return files.has(path)
          ? { ok: true, value: path }
          : fail(
              "ENOENT",
              `ENOENT: no such file or directory, realpath '${path}'`,
            );
    }
  }

  const fake: FakeNative = {
    files,
    events: [],
    requests: [],
    attach(attached) {
      host = attached;
    },
    request<T>(name: string, ...args: unknown[]) {
      const id = nextRequest++;
      return new Promise<T>((resolve, reject) => {
        answers.set(id, (ok, json) => {
          if (ok) resolve(JSON.parse(json) as T);
          else
            reject(
              new Error((JSON.parse(json) as { message: string }).message),
            );
        });
        host?.request(id, name, JSON.stringify(args));
      });
    },
    log() {
      // Tests read what the host does, not its log.
    },
    startTimer(id, milliseconds) {
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          host?.fireTimer(id);
        }, milliseconds),
      );
    },
    cancelTimer(id) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    },
    randomUUID,
    sha256(text) {
      return createHash("sha256").update(text).digest("hex");
    },
    fs(operation, argsJSON) {
      return JSON.stringify(
        operate(operation, JSON.parse(argsJSON) as unknown[]),
      );
    },
    watchFolder(_id, path) {
      return files.get(path)?.type === "directory";
    },
    unwatchFolder() {
      // Nothing changes the files behind the core's back in these tests.
    },
    github(id, requestJSON) {
      const request = JSON.parse(requestJSON) as GitHubRequest;
      fake.requests.push(request);
      const outcome = github(request);
      setTimeout(() => {
        host?.githubAnswered(id, JSON.stringify(outcome));
      }, 0);
    },
    tokenSource() {
      return tokenSource;
    },
    emit(name, payloadJSON) {
      fake.events.push({ name, payload: JSON.parse(payloadJSON) });
    },
    respond(id, ok, payloadJSON) {
      const answer = answers.get(id);
      answers.delete(id);
      answer?.(ok, payloadJSON);
    },
  };
  return fake;
}
