import type { Label } from "../contract.ts";
import { isObject } from "../json.ts";
import { parseRepositoryAddress } from "../repository-address.ts";
import type { CommandRunner } from "./command-runner.ts";
import type {
  GitHubAccess,
  GitHubError,
  GitHubResult,
  Issue,
  IssuePage,
  IssueReference,
  RepositorySummary,
} from "./port.ts";

export interface GhAdapterOptions {
  runCommand: CommandRunner;
}

/** The most issues GitHub returns in one page. */
const issuesPerPage = 100;

/** Another issue as a relationship names it. */
const referenceFields = "id number title state repository { nameWithOwner }";

/**
 * What Verdandi reads of an issue for a list. A parent has at most 100
 * sub-issues, and an issue at most 100 labels, so one page of each is all.
 */
const issueFields = `
  id number title state url updatedAt
  repository { nameWithOwner }
  labels(first: 100) { nodes { name color } }
  parent { ${referenceFields} }
  subIssuesSummary { total completed }
  issueDependenciesSummary { blockedBy blocking totalBlockedBy totalBlocking }
  subIssues(first: 100) { nodes { ${referenceFields} } }
`;

/** What Verdandi reads of a repository for the sidebar, without its issues. */
const repositorySummaryFields = `
  databaseId nameWithOwner hasIssuesEnabled isArchived
  issues(states: OPEN) { totalCount }
`;

/** The GitHub-access port implemented with `gh api`. */
export function createGhAdapter({
  runCommand,
}: GhAdapterOptions): GitHubAccess {
  /**
   * Runs one GraphQL query, failing on any error GitHub reports. Every query
   * also reads `viewer { login }`. Values reach GitHub as typed variables,
   * never spliced into the query.
   */
  async function graphql(
    selection: string,
    variables: Variables = {},
  ): Promise<GitHubResult<{ viewerLogin: string; data: unknown }>> {
    const result = await graphqlWithErrors(selection, variables);
    if (!result.ok) return result;
    const { viewerLogin, data, errors } = result.value;
    if (errors.length > 0) return { ok: false, error: graphqlError(errors) };
    return { ok: true, value: { viewerLogin, data } };
  }

  /**
   * Runs one GraphQL query like `graphql`, but keeps the data GitHub sends at
   * HTTP 200 alongside errors about parts of the query, such as a repository
   * it cannot resolve. Errors fail it only when there is no data.
   */
  async function graphqlWithErrors(
    selection: string,
    variables: Variables,
  ): Promise<
    GitHubResult<{ viewerLogin: string; data: unknown; errors: GraphqlError[] }>
  > {
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
    const errors = body?.errors ?? [];
    const viewerLogin = body?.data?.viewer?.login;
    if (typeof viewerLogin !== "string") {
      if (errors.length > 0) return { ok: false, error: graphqlError(errors) };
      return { ok: false, error: { kind: "unexpected-response" } };
    }
    return { ok: true, value: { viewerLogin, data: body?.data, errors } };
  }

  return {
    async fetchViewer() {
      const result = await graphql("");
      if (!result.ok) return result;
      return { ok: true, value: { login: result.value.viewerLogin } };
    },
    async fetchOpenIssues({ owner, name }, after) {
      const result = await graphql(
        // Ordered by creation, which never changes while the pages are
        // read; the list orders its issues itself.
        `repository(owner: $owner, name: $name) {
          closedIssues: issues(states: CLOSED) { totalCount }
          issues(
            states: OPEN
            first: ${String(issuesPerPage)}
            after: $after
            orderBy: { field: CREATED_AT, direction: DESC }
          ) {
            pageInfo { hasNextPage endCursor }
            nodes { ${issueFields} }
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
    async fetchIssues(ids) {
      const result = await graphql(
        `nodes(ids: $ids) { ... on Issue { ${issueFields} } }`,
        { ids: { type: "[ID!]!", value: ids } },
      );
      if (!result.ok) return result;
      const nodes = (result.value.data as { nodes?: unknown } | undefined)
        ?.nodes;
      const issues = Array.isArray(nodes) ? readIssues(nodes) : undefined;
      if (!issues) return { ok: false, error: { kind: "unexpected-response" } };
      return { ok: true, value: issues };
    },
    async fetchRepositorySummaries(repositories) {
      // One aliased `repository` per repository, so GitHub reports a missing
      // one on its own path and still answers for the others.
      const variables: Variables = {};
      const selections = repositories.map(({ owner, name }, index) => {
        const n = String(index);
        variables[`owner${n}`] = { type: "String!", value: owner };
        variables[`name${n}`] = { type: "String!", value: name };
        return `r${n}: repository(owner: $owner${n}, name: $name${n}) {
          ${repositorySummaryFields}
        }`;
      });
      const result = await graphqlWithErrors(selections.join("\n"), variables);
      if (!result.ok) return result;
      const { data, errors } = result.value;
      return {
        ok: true,
        value: repositories.map((_, index) => {
          const alias = `r${String(index)}`;
          const summary = isObject(data)
            ? readRepositorySummary(data[alias])
            : undefined;
          if (summary) return { ok: true, value: summary };
          const aboutIt = errors.filter((error) => error.path?.[0] === alias);
          return {
            ok: false,
            error:
              aboutIt.length > 0
                ? graphqlError(aboutIt)
                : { kind: "unexpected-response" },
          };
        }),
      };
    },
  };
}

/** GraphQL variables by name, each with its GraphQL type. */
type Variables = Record<string, { type: string; value: unknown }>;

/** Reads a repository's summary, or `undefined` if it is not one. */
function readRepositorySummary(node: unknown): RepositorySummary | undefined {
  if (!isObject(node)) return undefined;
  const { databaseId, nameWithOwner, hasIssuesEnabled, isArchived, issues } =
    node;
  const repository =
    typeof nameWithOwner === "string"
      ? parseRepositoryAddress(nameWithOwner)
      : undefined;
  const openIssueCount = isObject(issues) ? issues.totalCount : undefined;
  if (
    typeof databaseId !== "number" ||
    !repository ||
    typeof hasIssuesEnabled !== "boolean" ||
    typeof isArchived !== "boolean" ||
    typeof openIssueCount !== "number"
  ) {
    return undefined;
  }
  return {
    id: databaseId,
    repository,
    openIssueCount,
    hasIssuesEnabled,
    isArchived,
  };
}

/** The `data` of an issue page query, as far as it can be trusted. */
interface IssuePageData {
  repository?: {
    closedIssues?: { totalCount?: unknown };
    issues?: {
      pageInfo?: { hasNextPage?: unknown; endCursor?: unknown };
      nodes?: unknown;
    };
  } | null;
}

/** Reads a page of issues, or `undefined` if it is not one. */
function readIssuePage(data: unknown): IssuePage | undefined {
  const repository = (data as IssuePageData | undefined)?.repository;
  const connection = repository?.issues;
  const nodes = connection?.nodes;
  const closedIssueCount = repository?.closedIssues?.totalCount;
  const { hasNextPage, endCursor } = connection?.pageInfo ?? {};
  if (
    !Array.isArray(nodes) ||
    typeof hasNextPage !== "boolean" ||
    typeof closedIssueCount !== "number"
  ) {
    return undefined;
  }
  let nextPage: string | undefined;
  if (hasNextPage) {
    if (typeof endCursor !== "string") return undefined;
    nextPage = endCursor;
  }
  const issues = readIssues(nodes);
  if (!issues) return undefined;
  return { issues, closedIssueCount, nextPage };
}

/** Reads issue nodes, or `undefined` if any is not one. */
function readIssues(nodes: unknown[]): Issue[] | undefined {
  const issues: Issue[] = [];
  for (const node of nodes) {
    const issue = readIssue(node);
    if (!issue) return undefined;
    issues.push(issue);
  }
  return issues;
}

/** Reads one issue node, or `undefined` if it is not one. */
function readIssue(node: unknown): Issue | undefined {
  const reference = readReference(node);
  if (!reference || !isObject(node)) return undefined;
  const { url, updatedAt, labels, parent, subIssues } = node;
  const subIssuesSummary = readCounts(node.subIssuesSummary, [
    "total",
    "completed",
  ]);
  const issueDependenciesSummary = readCounts(node.issueDependenciesSummary, [
    "blockedBy",
    "totalBlockedBy",
    "blocking",
    "totalBlocking",
  ]);
  const labelList = readNodes(labels, readLabel);
  const subIssueList = readNodes(subIssues, readReference);
  const parentReference = parent === null ? null : readReference(parent);
  if (
    typeof url !== "string" ||
    typeof updatedAt !== "string" ||
    !subIssuesSummary ||
    !issueDependenciesSummary ||
    !labelList ||
    !subIssueList ||
    parentReference === undefined
  ) {
    return undefined;
  }
  return {
    ...reference,
    url,
    updatedAt,
    labels: labelList,
    parent: parentReference ?? undefined,
    subIssues: subIssueList,
    subIssuesSummary,
    issueDependenciesSummary,
  };
}

/** Reads a related issue, or `undefined` if it is not one. */
function readReference(node: unknown): IssueReference | undefined {
  if (!isObject(node)) return undefined;
  const { id, number, title, state } = node;
  const nameWithOwner = isObject(node.repository)
    ? node.repository.nameWithOwner
    : undefined;
  const repository =
    typeof nameWithOwner === "string"
      ? parseRepositoryAddress(nameWithOwner)
      : undefined;
  if (
    typeof id !== "string" ||
    typeof number !== "number" ||
    typeof title !== "string" ||
    (state !== "OPEN" && state !== "CLOSED") ||
    !repository
  ) {
    return undefined;
  }
  return {
    id,
    repository,
    number,
    title,
    state: state === "OPEN" ? "open" : "closed",
  };
}

function readLabel(node: unknown): Label | undefined {
  if (!isObject(node)) return undefined;
  const { name, color } = node;
  if (typeof name !== "string" || typeof color !== "string") return undefined;
  return { name, color };
}

/** Reads a connection's `nodes`, or `undefined` if any is unreadable. */
function readNodes<T>(
  connection: unknown,
  read: (node: unknown) => T | undefined,
): T[] | undefined {
  if (!isObject(connection) || !Array.isArray(connection.nodes)) {
    return undefined;
  }
  const values: T[] = [];
  for (const node of connection.nodes) {
    const value = read(node);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

/** Reads an object of counts, or `undefined` if one is not a number. */
function readCounts<K extends string>(
  value: unknown,
  keys: K[],
): Record<K, number> | undefined {
  if (!isObject(value)) return undefined;
  const counts = {} as Record<K, number>;
  for (const key of keys) {
    const count = value[key];
    if (typeof count !== "number") return undefined;
    counts[key] = count;
  }
  return counts;
}

/** A GraphQL response body, as far as it can be trusted. */
interface GraphqlBody {
  data?: { viewer?: { login?: unknown } } | null;
  errors?: GraphqlError[];
}

/** The domain error for errors GitHub reported with a GraphQL response. */
function graphqlError(errors: readonly GraphqlError[]): GitHubError {
  return { kind: "graphql", messages: errors.map((error) => error.message) };
}

/**
 * An error GitHub reports with a GraphQL response. Its `path` names the part
 * of the query it concerns, e.g. an alias.
 */
interface GraphqlError {
  message: string;
  path?: (string | number)[];
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
