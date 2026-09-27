import type { CommandRunner } from "./command-runner.ts";
import type { GitHubAccess, GitHubResult, Issue, IssuePage } from "./port.ts";

export interface GhAdapterOptions {
  runCommand: CommandRunner;
}

/** The most issues GitHub returns in one page. */
const issuesPerPage = 100;

/** The GitHub-access port implemented with `gh api`. */
export function createGhAdapter({
  runCommand,
}: GhAdapterOptions): GitHubAccess {
  /**
   * Runs one GraphQL query. Every query also reads `viewer { login }`.
   * Values reach GitHub as typed variables, never spliced into the query.
   */
  async function graphql(
    selection: string,
    variables: Record<string, { type: string; value: unknown }> = {},
  ): Promise<GitHubResult<{ viewerLogin: string; data: unknown }>> {
    const entries = Object.entries(variables);
    const declarations = entries.map(([name, { type }]) => `$${name}: ${type}`);
    const operation = entries.length
      ? `query(${declarations.join(", ")})`
      : "query";
    const query = `${operation} { viewer { login } ${selection} }`;
    const values = entries.length
      ? Object.fromEntries(entries.map(([name, { value }]) => [name, value]))
      : undefined;
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
      { input: JSON.stringify({ query, variables: values }) },
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
    async fetchOpenIssues({ owner, name }, after) {
      const result = await graphql(
        `repository(owner: $owner, name: $name) {
          issues(
            states: OPEN
            first: ${String(issuesPerPage)}
            after: $after
            orderBy: { field: CREATED_AT, direction: DESC }
          ) {
            pageInfo { hasNextPage endCursor }
            nodes { id number title state }
          }
        }`,
        {
          owner: { type: "String!", value: owner },
          name: { type: "String!", value: name },
          after: { type: "String", value: after },
        },
      );
      if (!result.ok) return result;
      const page = readIssuePage(result.value.data);
      if (!page) return { ok: false, error: { kind: "unexpected-response" } };
      return { ok: true, value: page };
    },
  };
}

/** The `data` of an issue page query, as far as it can be trusted. */
interface IssuePageData {
  repository?: {
    issues?: {
      pageInfo?: { hasNextPage?: unknown; endCursor?: unknown };
      nodes?: unknown;
    };
  } | null;
}

/** Reads a page of issues, or `undefined` if it is not one. */
function readIssuePage(data: unknown): IssuePage | undefined {
  const connection = (data as IssuePageData | undefined)?.repository?.issues;
  const nodes = connection?.nodes;
  const { hasNextPage, endCursor } = connection?.pageInfo ?? {};
  if (!Array.isArray(nodes) || typeof hasNextPage !== "boolean") {
    return undefined;
  }
  let nextPage: string | undefined;
  if (hasNextPage) {
    if (typeof endCursor !== "string") return undefined;
    nextPage = endCursor;
  }
  const issues: Issue[] = [];
  for (const node of nodes) {
    const issue = readIssue(node);
    if (!issue) return undefined;
    issues.push(issue);
  }
  return { issues, nextPage };
}

/** Reads one issue node, or `undefined` if it is not one. */
function readIssue(node: unknown): Issue | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const { id, number, title, state } = node as Record<string, unknown>;
  if (
    typeof id !== "string" ||
    typeof number !== "number" ||
    typeof title !== "string" ||
    (state !== "OPEN" && state !== "CLOSED")
  ) {
    return undefined;
  }
  return { id, number, title, state: state === "OPEN" ? "open" : "closed" };
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
