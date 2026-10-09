/**
 * `node:fs/promises` for the iOS host: the few operations the core's
 * settings files use, each done at once by the app.
 */
import { native, type FileOperation } from "../native.ts";

/** An error as Node's file system gives one, with its `code`. */
export class FileSystemError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "Error";
  }
}

type Answer =
  { ok: true; value: unknown } | { ok: false; code: string; message: string };

/** Runs one file operation in the app, throwing as Node would. */
function run(operation: FileOperation, args: unknown[]): unknown {
  const answer = JSON.parse(
    native().fs(operation, JSON.stringify(args)),
  ) as Answer;
  if (!answer.ok) throw new FileSystemError(answer.code, answer.message);
  return answer.value;
}

/** What `stat` and `lstat` answer, as far as the core asks. */
export interface Stats {
  mode: number;
  size: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface StatValue {
  mode: number;
  size: number;
  type: "file" | "directory" | "link" | "other";
}

function stats({ mode, size, type }: StatValue): Stats {
  return {
    mode,
    size,
    isDirectory: () => type === "directory",
    isFile: () => type === "file",
    isSymbolicLink: () => type === "link",
  };
}

function encodingOf(
  options: BufferEncoding | { encoding?: BufferEncoding | null } | undefined,
) {
  return typeof options === "string" ? options : options?.encoding;
}

export function readFile(
  path: string,
  options?: BufferEncoding | { encoding?: BufferEncoding | null },
): Promise<string> {
  return attempt(() => {
    const encoding = encodingOf(options);
    if (encoding !== undefined && encoding !== null && encoding !== "utf8")
      throw new Error(`Only UTF-8 can be read, not ${encoding}.`);
    return run("readFile", [path]) as string;
  });
}

export function writeFile(
  path: string,
  data: string,
  options?: { flag?: string; mode?: number | undefined } | BufferEncoding,
): Promise<void> {
  return attempt(() => {
    const flag = typeof options === "object" ? options.flag : undefined;
    const mode = typeof options === "object" ? options.mode : undefined;
    run("writeFile", [path, data, flag ?? "w", mode ?? null]);
  });
}

export function rename(from: string, to: string): Promise<void> {
  return attempt(() => {
    run("rename", [from, to]);
  });
}

export function rm(
  path: string,
  options?: { force?: boolean; recursive?: boolean },
): Promise<void> {
  return attempt(() => {
    run("rm", [path, options?.force ?? false, options?.recursive ?? false]);
  });
}

export function lstat(path: string): Promise<Stats> {
  return attempt(() => stats(run("lstat", [path]) as StatValue));
}

export function stat(path: string): Promise<Stats> {
  return attempt(() => stats(run("stat", [path]) as StatValue));
}

export function mkdir(
  path: string,
  options?: { recursive?: boolean },
): Promise<string | undefined> {
  return attempt(() => {
    run("mkdir", [path, options?.recursive ?? false]);
    return undefined;
  });
}

export function realpath(path: string): Promise<string> {
  return attempt(() => run("realpath", [path]) as string);
}

/** Runs it at once, but answers as Node does: in a promise, never throwing. */
function attempt<T>(action: () => T): Promise<T> {
  try {
    return Promise.resolve(action());
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

export default {
  readFile,
  writeFile,
  rename,
  rm,
  lstat,
  stat,
  mkdir,
  realpath,
};
