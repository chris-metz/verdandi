import type { CommandRunner } from "./command-runner.ts";
import type { GitHubAccess, GitHubResult } from "./port.ts";

export interface GhAdapterOptions {
  runCommand: CommandRunner;
}

/** The GitHub-access port implemented with `gh api`. */
export function createGhAdapter({
  runCommand,
}: GhAdapterOptions): GitHubAccess {
  /** Runs one GraphQL query. Every query also reads `viewer { login }`. */
  async function graphql(
    selection: string,
  ): Promise<GitHubResult<{ viewerLogin: string; data: unknown }>> {
    const query = `query { viewer { login } ${selection} }`;
    const result = await runCommand(
      "gh",
      [
        "api",
        "graphql",
        "--hostname",
        "github.com",
        "--include",
        "--input",
        "-",
      ],
      { input: JSON.stringify({ query }) },
    );
    if (result.kind === "not-found") {
      return { ok: false, error: { kind: "gh-not-found" } };
    }
    if (result.kind === "failed-to-start") {
      return {
        ok: false,
        error: { kind: "gh-failed", message: result.message },
      };
    }
    const response = parseTranscript(result.stdout);
    if (!response) {
      const message =
        result.stderr.trim() ||
        `gh exited with code ${String(result.exitCode)}`;
      return { ok: false, error: { kind: "gh-failed", message } };
    }
    if (response.status >= 400) {
      const message =
        readMessage(response.body) ?? `HTTP ${String(response.status)}`;
      return {
        ok: false,
        error: { kind: "http", status: response.status, message },
      };
    }
    const body = parseJson(response.body) as GraphqlBody | undefined;
    if (body?.errors?.length) {
      return {
        ok: false,
        error: {
          kind: "graphql",
          messages: body.errors.map((error) => error.message),
        },
      };
    }
    const viewerLogin = body?.data?.viewer?.login;
    if (typeof viewerLogin !== "string") {
      return { ok: false, error: { kind: "unexpected-response" } };
    }
    return { ok: true, value: { viewerLogin, data: body?.data } };
  }

  return {
    async fetchViewer() {
      const result = await graphql("");
      if (!result.ok) return result;
      return { ok: true, value: { login: result.value.viewerLogin } };
    },
  };
}

/** A GraphQL response body, as far as it can be trusted. */
interface GraphqlBody {
  data?: { viewer?: { login?: unknown } } | null;
  errors?: { message: string }[];
}

interface HttpResponse {
  status: number;
  body: string;
}

/**
 * Splits the output of `gh api --include`: a status line such as
 * `HTTP/2.0 200 OK`, header lines, a blank line, then the body.
 */
function parseTranscript(output: string): HttpResponse | undefined {
  const statusLine = /^HTTP\/[\d.]+ (\d{3})[^\n]*\n/.exec(output);
  const separator = /\r?\n\r?\n/.exec(output);
  if (!statusLine || !separator) return undefined;
  return {
    status: Number(statusLine[1]),
    body: output.slice(separator.index + separator[0].length),
  };
}

/** The `message` of a GitHub error body, if the body has one. */
function readMessage(body: string): string | undefined {
  const parsed = parseJson(body);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "message" in parsed &&
    typeof parsed.message === "string"
  ) {
    return parsed.message;
  }
  return undefined;
}

/** The parsed body, or `undefined` if it is not JSON, e.g. an HTML page. */
function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
