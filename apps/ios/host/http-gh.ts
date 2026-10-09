/**
 * `gh`, as far as the core runs it, answered over HTTPS instead: iOS runs
 * no processes and has no `gh`. The core's `gh` adapter stays as it is and
 * reads these answers as it reads gh's, so the core cannot tell. The app
 * keeps the token and sends the requests; neither the token nor the
 * account's credentials ever reach the core.
 *
 * It answers only what the core asks of gh: `--version`, `auth status
 * --json hosts`, and `api` with `--include`, for GraphQL (its query on
 * standard input) and for REST reads (`--method GET` with `-f` fields as
 * query parameters).
 */
import type { CommandResult, CommandRunner, TokenSource } from "@verdandi/core";
import type { GitHubOutcome, GitHubRequest } from "./native.ts";

/** Where the host's `gh` is, on the PATH it gives the core. */
export const ghFolder = "/Verdandi/bin";
export const ghPath = `${ghFolder}/gh`;

/** The gh version it answers as: the oldest the core accepts. */
export const emulatedVersion = "2.81.0";

/** Sends requests to GitHub's API with the app's token. */
export interface GitHubHttp {
  send(request: GitHubRequest): Promise<GitHubOutcome>;
  /** Where the app's token comes from, or none without one. */
  tokenSource(): TokenSource | undefined;
}

/** A command runner that answers `gh` at `ghPath` over `http`. */
export function createHttpGh(http: GitHubHttp): CommandRunner {
  return async (command, args, options) => {
    if (command !== ghPath) return { kind: "not-found" };
    const answer = answerGh(http, args, options?.input);
    if (options?.timeout === undefined) return answer;
    const timeout = options.timeout;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<CommandResult>((resolve) => {
      timer = setTimeout(() => {
        resolve({ kind: "timed-out" });
      }, timeout);
    });
    try {
      return await Promise.race([answer, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  };
}

async function answerGh(
  http: GitHubHttp,
  args: readonly string[],
  input: string | undefined,
): Promise<CommandResult> {
  const [first, second] = args;
  if (first === "--version")
    return exited(
      0,
      `gh version ${emulatedVersion} (Verdandi for iOS)\nhttps://github.com/cli/cli/releases/tag/v${emulatedVersion}\n`,
    );
  if (first === "auth" && second === "status") return authStatus(http);
  if (first === "api") return api(http, args.slice(1), input);
  return exited(1, "", `unknown command "${String(first)}" for "gh"\n`);
}

/**
 * `gh auth status --json hosts --hostname github.com --active`: GitHub is
 * asked who the token belongs to, as gh asks it.
 */
async function authStatus(http: GitHubHttp): Promise<CommandResult> {
  const signedOut = exited(0, `${JSON.stringify({ hosts: {} })}\n`);
  const source = http.tokenSource();
  if (source === undefined) return signedOut;
  const outcome = await http.send({ method: "GET", path: "user", query: [] });
  if (outcome.kind === "signed-out") return signedOut;
  const entry = {
    active: true,
    host: "github.com",
    gitProtocol: "https",
    tokenSource: source === "stored" ? "keyring" : source,
  };
  const status = (fields: Record<string, unknown>) =>
    exited(
      0,
      `${JSON.stringify({ hosts: { "github.com": [{ ...entry, ...fields }] } })}\n`,
    );
  if (outcome.kind === "unreachable")
    return status({ state: "error", error: outcome.message, login: "" });
  const login = readLogin(outcome.body);
  if (outcome.status === 200 && login !== undefined)
    return status({ state: "success", login });
  const message = readMessage(outcome.body) ?? statusText(outcome.status);
  return status({
    state: "error",
    error: `HTTP ${String(outcome.status)}: ${message} (https://api.github.com/user)`,
    login: login ?? "",
  });
}

/** `gh api` with `--include`, for the endpoints the core reads. */
async function api(
  http: GitHubHttp,
  args: readonly string[],
  input: string | undefined,
): Promise<CommandResult> {
  const parsed = parseApiArgs(args);
  if (!parsed.ok) return exited(1, "", `${parsed.message}\n`);
  const { endpoint, method, fields, readsInput, hostname } = parsed;
  if (hostname !== undefined && hostname !== "github.com")
    return exited(1, "", `Verdandi for iOS reads github.com only.\n`);
  if (readsInput && input === undefined)
    return exited(1, "", "--input - needs standard input.\n");
  const request: GitHubRequest =
    endpoint === "graphql"
      ? {
          method: "POST",
          path: "graphql",
          query: [],
          body:
            readsInput && input !== undefined
              ? input
              : JSON.stringify(Object.fromEntries(fields)),
        }
      : method === "GET"
        ? { method: "GET", path: endpoint, query: fields }
        : {
            method: "POST",
            path: endpoint,
            query: [],
            body:
              readsInput && input !== undefined
                ? input
                : JSON.stringify(Object.fromEntries(fields)),
          };
  const outcome = await http.send(request);
  switch (outcome.kind) {
    case "signed-out":
      // gh's own exit code when it has no credentials.
      return exited(
        4,
        "",
        "To get started with Verdandi for iOS, sign in to GitHub.\n",
      );
    case "unreachable":
      return exited(
        1,
        "",
        `error connecting to api.github.com: ${outcome.message}\n`,
      );
    case "response": {
      // As gh prints it: the status line ends in LF, each header in CRLF,
      // then a blank CRLF line and the body.
      const headers = outcome.headers
        .map(([name, value]) => `${name}: ${value}\r\n`)
        .join("");
      const stdout = `HTTP/2.0 ${String(outcome.status)} ${statusText(outcome.status)}\n${headers}\r\n${outcome.body}`;
      if (outcome.status < 400) return exited(0, stdout);
      const message = readMessage(outcome.body) ?? statusText(outcome.status);
      return exited(
        1,
        stdout,
        `gh: ${message} (HTTP ${String(outcome.status)})\n`,
      );
    }
  }
}

type ApiArgs =
  | {
      ok: true;
      endpoint: string;
      method: "GET" | "POST";
      fields: [string, string][];
      readsInput: boolean;
      hostname: string | undefined;
    }
  | { ok: false; message: string };

/** Reads `gh api`'s arguments, as far as the core passes them. */
export function parseApiArgs(args: readonly string[]): ApiArgs {
  let endpoint: string | undefined;
  let method: string | undefined;
  let hostname: string | undefined;
  let readsInput = false;
  const fields: [string, string][] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    const value = () => {
      index++;
      const next = args[index];
      if (next === undefined) throw new Error(`${arg} needs a value.`);
      return next;
    };
    try {
      switch (arg) {
        case "--include":
        case "-i":
        case "--silent":
          break;
        case "--method":
        case "-X":
          method = value().toUpperCase();
          break;
        case "--hostname":
          hostname = value();
          break;
        case "--input":
          if (value() !== "-")
            return { ok: false, message: "Only --input - is answered." };
          readsInput = true;
          break;
        case "-f":
        case "--raw-field":
        case "-F":
        case "--field": {
          const field = value();
          const equals = field.indexOf("=");
          if (equals <= 0)
            return { ok: false, message: `${arg} needs key=value.` };
          fields.push([field.slice(0, equals), field.slice(equals + 1)]);
          break;
        }
        default:
          if (arg.startsWith("-"))
            return { ok: false, message: `unknown flag: ${arg}` };
          if (endpoint !== undefined)
            return { ok: false, message: `unexpected argument: ${arg}` };
          endpoint = arg.replace(/^\//, "");
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (endpoint === undefined)
    return { ok: false, message: "gh api needs an endpoint." };
  const resolved = method ?? (fields.length > 0 || readsInput ? "POST" : "GET");
  if (resolved !== "GET" && resolved !== "POST")
    return { ok: false, message: `Only GET and POST are answered.` };
  return {
    ok: true,
    endpoint,
    method: resolved,
    fields,
    readsInput,
    hostname,
  };
}

function exited(exitCode: number, stdout: string, stderr = ""): CommandResult {
  return { kind: "exited", exitCode, stdout, stderr };
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function readLogin(body: string): string | undefined {
  const json = parse(body);
  return typeof json === "object" &&
    json !== null &&
    "login" in json &&
    typeof json.login === "string"
    ? json.login
    : undefined;
}

function readMessage(body: string): string | undefined {
  const json = parse(body);
  return typeof json === "object" &&
    json !== null &&
    "message" in json &&
    typeof json.message === "string"
    ? json.message
    : undefined;
}

/** The reason phrase of an HTTP status, as gh prints it. */
export function statusText(status: number): string {
  const texts: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    410: "Gone",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  return texts[status] ?? "";
}
