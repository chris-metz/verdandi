/**
 * `node:path` for the iOS host: POSIX paths only, which are all iOS has.
 * `win32` is the same, as the host never runs on Windows.
 */

export const sep = "/";
export const delimiter = ":";

export function isAbsolute(path: string): boolean {
  return path.startsWith("/");
}

/** Resolves `.` and `..` and repeated slashes, as Node's `normalize` does. */
export function normalize(path: string): string {
  if (path === "") return ".";
  const absolute = isAbsolute(path);
  const trailing = path.endsWith("/");
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments.at(-1) !== "..") segments.pop();
      else if (!absolute) segments.push("..");
      continue;
    }
    segments.push(segment);
  }
  const joined = segments.join("/");
  if (absolute) return `/${joined}${trailing && joined ? "/" : ""}`;
  if (joined === "") return trailing ? "./" : ".";
  return trailing ? `${joined}/` : joined;
}

export function join(...segments: string[]): string {
  const parts = segments.filter((segment) => segment !== "");
  return parts.length === 0 ? "." : normalize(parts.join("/"));
}

export function resolve(...segments: string[]): string {
  let resolved = "";
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    if (segment === undefined || segment === "") continue;
    resolved = resolved === "" ? segment : `${segment}/${resolved}`;
    if (isAbsolute(segment)) break;
  }
  const normalized = normalize(
    isAbsolute(resolved) ? resolved : `/${resolved}`,
  );
  return normalized.length > 1 && normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

export function dirname(path: string): string {
  if (path === "") return ".";
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const slash = trimmed.lastIndexOf("/");
  if (slash === -1) return ".";
  if (slash === 0) return "/";
  return trimmed.slice(0, slash);
}

export function basename(path: string, extension?: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return extension !== undefined &&
    base.endsWith(extension) &&
    base !== extension
    ? base.slice(0, -extension.length)
    : base;
}

export function extname(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot);
}

const posixPath = {
  sep,
  delimiter,
  isAbsolute,
  normalize,
  join,
  resolve,
  dirname,
  basename,
  extname,
};

export const posix = posixPath;
export const win32 = posixPath;

export default { ...posixPath, posix: posixPath, win32: posixPath };
