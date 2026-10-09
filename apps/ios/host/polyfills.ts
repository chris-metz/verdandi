/**
 * What JavaScriptCore lacks of the globals the core uses: timers, `URL`
 * and `console`. Each is installed only where it is missing, so the same
 * host runs under Node in tests.
 */
import { native } from "./native.ts";

/** A timer as Node's `setTimeout` answers it, which the core may `unref`. */
export class Timeout {
  constructor(readonly id: number) {}
  ref() {
    return this;
  }
  unref() {
    return this;
  }
  hasRef() {
    return true;
  }
  [Symbol.toPrimitive]() {
    return this.id;
  }
}

interface Timer {
  run: () => void;
  /** For an interval: how long until it runs again. */
  repeat: number | undefined;
}

let nextTimer = 1;
const timers = new Map<number, Timer>();

function idOf(timer: unknown): number | undefined {
  if (timer instanceof Timeout) return timer.id;
  return typeof timer === "number" ? timer : undefined;
}

function start(run: () => void, milliseconds: unknown, repeat: boolean) {
  const delay = Math.max(0, Number(milliseconds) || 0);
  const id = nextTimer++;
  timers.set(id, { run, repeat: repeat ? delay : undefined });
  native().startTimer(id, delay);
  return new Timeout(id);
}

function clear(timer: unknown) {
  const id = idOf(timer);
  if (id !== undefined && timers.delete(id)) native().cancelTimer(id);
}

/** Called by the app when a timer is due. */
export function fireTimer(id: number) {
  const timer = timers.get(id);
  if (!timer) return;
  if (timer.repeat === undefined) timers.delete(id);
  else native().startTimer(id, timer.repeat);
  try {
    timer.run();
  } catch (error) {
    native().log("error", `A timer failed: ${describe(error)}`);
  }
}

/** A thrown value as one line, with its stack when it has one. */
export function describe(error: unknown): string {
  if (error instanceof Error)
    return error.stack ? `${error.message}\n${error.stack}` : error.message;
  return String(error);
}

/**
 * The URL search parameters the core uses: reading and setting them, in
 * order, encoded as a form encodes them.
 */
class SearchParams {
  readonly #pairs: [string, string][];
  readonly #changed: () => void;
  constructor(search: string, changed: () => void) {
    this.#changed = changed;
    this.#pairs = search
      .replace(/^\?/, "")
      .split("&")
      .filter((pair) => pair !== "")
      .map((pair) => {
        const equals = pair.indexOf("=");
        const decode = (text: string) =>
          decodeURIComponent(text.replace(/\+/g, " "));
        return equals === -1
          ? [decode(pair), ""]
          : [decode(pair.slice(0, equals)), decode(pair.slice(equals + 1))];
      });
  }
  get(name: string): string | null {
    return this.#pairs.find(([key]) => key === name)?.[1] ?? null;
  }
  has(name: string): boolean {
    return this.#pairs.some(([key]) => key === name);
  }
  /** Sets the first pair of the name, removing any others, or adds one. */
  set(name: string, value: string) {
    const index = this.#pairs.findIndex(([key]) => key === name);
    if (index === -1) this.#pairs.push([name, value]);
    else {
      this.#pairs[index] = [name, value];
      for (let at = this.#pairs.length - 1; at > index; at--)
        if (this.#pairs[at]?.[0] === name) this.#pairs.splice(at, 1);
    }
    this.#changed();
  }
  append(name: string, value: string) {
    this.#pairs.push([name, value]);
    this.#changed();
  }
  delete(name: string) {
    const rest = this.#pairs.filter(([key]) => key !== name);
    this.#pairs.length = 0;
    this.#pairs.push(...rest);
    this.#changed();
  }
  toString(): string {
    const encode = (text: string) =>
      encodeURIComponent(text).replace(/%20/g, "+");
    return this.#pairs
      .map(([key, value]) => `${encode(key)}=${encode(value)}`)
      .join("&");
  }
}

const absoluteUrl =
  /^([a-zA-Z][a-zA-Z\d+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/;

/** An absolute URL with a host, such as `https://…`, as far as the core uses one. */
class MinimalUrl {
  protocol: string;
  host: string;
  pathname: string;
  search: string;
  hash: string;
  readonly searchParams: SearchParams;
  constructor(text: string) {
    const match = absoluteUrl.exec(text);
    if (!match) throw new TypeError(`Invalid URL: ${text}`);
    this.protocol = match[1]?.toLowerCase() ?? "";
    this.host = match[2]?.toLowerCase() ?? "";
    this.pathname = match[3] || "/";
    this.search = match[4] === "?" ? "" : (match[4] ?? "");
    this.hash = match[5] === "#" ? "" : (match[5] ?? "");
    this.searchParams = new SearchParams(this.search, () => {
      const query = this.searchParams.toString();
      this.search = query === "" ? "" : `?${query}`;
    });
  }
  static canParse(text: string): boolean {
    return absoluteUrl.test(text);
  }
  get hostname(): string {
    return this.host.replace(/:\d+$/, "");
  }
  get origin(): string {
    return `${this.protocol}//${this.host}`;
  }
  get href(): string {
    return `${this.origin}${this.pathname}${this.search}${this.hash}`;
  }
  toString(): string {
    return this.href;
  }
  toJSON(): string {
    return this.href;
  }
}

/** Installs what is missing, using the native functions set before. */
export function installPolyfills() {
  const scope = globalThis as Record<string, unknown>;
  if (typeof scope.setTimeout !== "function") {
    scope.setTimeout = (
      run: (...args: unknown[]) => void,
      ms?: unknown,
      ...args: unknown[]
    ) =>
      start(
        () => {
          run(...args);
        },
        ms,
        false,
      );
    scope.setInterval = (
      run: (...args: unknown[]) => void,
      ms?: unknown,
      ...args: unknown[]
    ) =>
      start(
        () => {
          run(...args);
        },
        ms,
        true,
      );
    scope.clearTimeout = clear;
    scope.clearInterval = clear;
  }
  if (typeof scope.URL !== "function") scope.URL = MinimalUrl;
  if (typeof scope.console !== "object") {
    const write =
      (level: "debug" | "info" | "warn" | "error") =>
      (...values: unknown[]) => {
        native().log(
          level,
          values
            .map((value) => {
              if (typeof value === "string") return value;
              if (value instanceof Error) return describe(value);
              try {
                return JSON.stringify(value);
              } catch {
                return String(value);
              }
            })
            .join(" "),
        );
      };
    scope.console = {
      debug: write("debug"),
      log: write("info"),
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
    };
  }
}

export { MinimalUrl as UrlForTests };
