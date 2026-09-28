import type {
  AccessEvidence,
  IssueActor,
  IssueMetadata,
  Label,
} from "../contract.ts";
import { isObject } from "../json.ts";
import { parseRepositoryAddress } from "../repository-address.ts";
import type { CommandResult, CommandRunner } from "./command-runner.ts";
import type {
  AuthStatus,
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
  /** The gh executable to run. */
  gh: string;
}

/** How long `gh auth status` may take, in milliseconds. */
const authStatusTimeout = 30 * 1000;

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
  gh,
}: GhAdapterOptions): GitHubAccess {
  /**
   * Runs one GraphQL query, keeping the data GitHub sends at HTTP 200
   * alongside errors about parts of the query, such as a repository it
   * cannot resolve, for each method to place. Errors fail it only when there
   * is no data. Every query also reads `viewer { login }`. Values reach
   * GitHub as typed variables, never spliced into the query.
   */
  async function graphql(
    selection: string,
    variables: Variables = {},
  ): Promise<GitHubResult<GraphqlAnswer>> {
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
      gh,
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
    if (result.kind !== "exited") {
      return { ok: false, error: runFailure(result) };
    }
    const response = parseTranscript(result.stdout);
    if (!response) return { ok: false, error: exitFailure(result) };
    const { status, headers } = response;
    if (status >= 400) {
      const message = readMessage(response.body) ?? `HTTP ${String(status)}`;
      return { ok: false, error: httpError(status, message, headers) };
    }
    const body = parseJson(response.body) as GraphqlBody | undefined;
    const errors = body?.errors ?? [];
    const viewerLogin = body?.data?.viewer?.login;
    if (typeof viewerLogin !== "string") {
      if (errors.length > 0) {
        return { ok: false, error: graphqlError(errors, headers) };
      }
      return { ok: false, error: { kind: "unexpected-response" } };
    }
    return {
      ok: true,
      value: { viewerLogin, data: body?.data, errors, headers },
    };
  }

  return {
    async fetchAuthStatus() {
      const result = await runCommand(
        gh,
        [
          "auth",
          "status",
          "--json",
          "hosts",
          "--hostname",
          "github.com",
          "--active",
        ],
        // Every request waits for this check, so it must end.
        { timeout: authStatusTimeout },
      );
      if (result.kind !== "exited") {
        return { ok: false, error: runFailure(result) };
      }
      // With `--json`, gh exits with 0 whatever the credentials' state.
      if (result.exitCode !== 0) {
        return { ok: false, error: exitFailure(result) };
      }
      return readAuthStatus(parseJson(result.stdout));
    },
    async fetchIssueDetails(id) {
      const result = await graphql(
        `node(id: $id) { ... on Issue {
          ${issueFields}
          stateReason createdAt
          author { login avatarUrl }
          assignees(first: 100) { nodes { login avatarUrl } }
          milestone { title }
          comments { totalCount }
        } }`,
        { id: { type: "ID!", value: id } },
      );
      if (!result.ok) return result;
      const { data, errors, headers } = result.value;
      const node = isObject(data) ? data.node : undefined;
      const read = readIssueNode(node, errorsAbout(errors, ["node"]), headers);
      if (!read.ok) return read;
      const metadata = readMetadata(node, read.value.incomplete !== undefined);
      if (!metadata) {
        return { ok: false, error: { kind: "unexpected-response" } };
      }
      return { ok: true, value: { ...read.value, ...metadata } };
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
      const { data, errors, headers } = result.value;
      const page = readIssuePage(data, errors, headers);
      if (page) return { ok: true, value: page };
      // GitHub answered without the repository, or without its issues.
      const aboutIt = errorsAbout(errors, ["repository"]);
      return {
        ok: false,
        error:
          aboutIt.length > 0
            ? graphqlError(aboutIt, headers)
            : { kind: "unexpected-response" },
      };
    },
    async fetchIssues(ids) {
      const result = await graphql(
        `nodes(ids: $ids) { ... on Issue { ${issueFields} } }`,
        { ids: { type: "[ID!]!", value: ids } },
      );
      if (!result.ok) return result;
      const { data, errors, headers } = result.value;
      const nodes = isObject(data) ? data.nodes : undefined;
      if (!Array.isArray(nodes)) {
        return {
          ok: false,
          error:
            errors.length > 0
              ? graphqlError(errors, headers)
              : { kind: "unexpected-response" },
        };
      }
      // Each issue is GitHub's answer in its place, whatever the others'.
      return {
        ok: true,
        value: ids.map((_, index) =>
          readIssueNode(
            (nodes as unknown[])[index],
            errorsAbout(errors, ["nodes", index]),
            headers,
          ),
        ),
      };
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
      const result = await graphql(selections.join("\n"), variables);
      if (!result.ok) return result;
      const { data, errors, headers } = result.value;
      return {
        ok: true,
        value: repositories.map((_, index) => {
          const alias = `r${String(index)}`;
          const summary = isObject(data)
            ? readRepositorySummary(data[alias])
            : undefined;
          if (summary) return { ok: true, value: summary };
          const aboutIt = errorsAbout(errors, [alias]);
          return {
            ok: false,
            error:
              aboutIt.length > 0
                ? graphqlError(aboutIt, headers)
                : { kind: "unexpected-response" },
          };
        }),
      };
    },
  };
}

/** The domain error for gh that did not run to its end. */
function runFailure(
  result: Exclude<CommandResult, { kind: "exited" }>,
): GitHubError {
  switch (result.kind) {
    case "not-found":
      return { kind: "gh-not-found" };
    case "failed-to-start":
      return { kind: "gh-unusable", message: result.message };
    case "timed-out":
      return { kind: "gh-failed", message: "gh did not finish in time." };
  }
}

/**
 * The domain error for gh that exited without an answer from GitHub. Exit
 * code 4 is gh's own: it has no credentials and asks to log in.
 */
function exitFailure(
  result: Extract<CommandResult, { kind: "exited" }>,
): GitHubError {
  const message =
    result.stderr.trim() || `gh exited with code ${String(result.exitCode)}`;
  return result.exitCode === 4
    ? { kind: "gh-signed-out", message }
    : { kind: "gh-failed", message };
}

/**
 * Reads `gh auth status --json hosts` for github.com's active account. A
 * rejection counts only with GitHub's HTTP 401 as evidence; any other
 * failure to check, such as a timeout, a connection or server error,
 * confirms nothing.
 */
function readAuthStatus(json: unknown): GitHubResult<AuthStatus> {
  const hosts = isObject(json) ? json.hosts : undefined;
  if (!isObject(hosts)) {
    return { ok: false, error: { kind: "unexpected-response" } };
  }
  const entries = hosts["github.com"];
  if (entries === undefined) {
    return { ok: true, value: { state: "signed-out" } };
  }
  const entry = Array.isArray(entries)
    ? (entries as unknown[]).find(
        (candidate) => isObject(candidate) && candidate.active === true,
      )
    : undefined;
  if (!isObject(entry)) {
    return { ok: false, error: { kind: "unexpected-response" } };
  }
  const { state, login, tokenSource, error } = entry;
  if (typeof login !== "string" || typeof tokenSource !== "string") {
    return { ok: false, error: { kind: "unexpected-response" } };
  }
  const source =
    tokenSource === "GH_TOKEN" || tokenSource === "GITHUB_TOKEN"
      ? tokenSource
      : "stored";
  if (state === "success" && login !== "") {
    return {
      ok: true,
      value: { state: "signed-in", login, tokenSource: source },
    };
  }
  const message = typeof error === "string" ? error : "";
  if (state === "error" && /\b(?:HTTP|status code:) 401\b/.test(message)) {
    return {
      ok: true,
      value: {
        state: "rejected",
        login: login === "" ? undefined : login,
        tokenSource: source,
        message,
      },
    };
  }
  if (state === "error" || state === "timeout") {
    return { ok: false, error: { kind: "gh-failed", message } };
  }
  return { ok: false, error: { kind: "unexpected-response" } };
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

/**
 * Reads a page of issues, or `undefined` if it is not one. Issues GitHub
 * reported errors about instead of answering are left out, and the page is
 * marked incomplete.
 */
function readIssuePage(
  data: unknown,
  errors: readonly GraphqlError[],
  headers: ResponseHeaders,
): IssuePage | undefined {
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
  const issues: Issue[] = [];
  const leftOut: GraphqlError[] = [];
  for (const [index, node] of (nodes as unknown[]).entries()) {
    const aboutIt = errorsAbout(errors, [
      "repository",
      "issues",
      "nodes",
      index,
    ]);
    const read = readIssueNode(node, aboutIt, headers);
    if (read.ok) issues.push(read.value);
    else if (aboutIt.length > 0) leftOut.push(...aboutIt);
    else return undefined;
  }
  return {
    issues,
    closedIssueCount,
    nextPage,
    incomplete: leftOut.length > 0 ? graphqlError(leftOut, headers) : undefined,
  };
}

/**
 * Reads an issue node that GitHub answered with the errors about it. A node
 * GitHub left out fails with those errors, or as unavailable when it gave
 * none, as it may for an issue this account cannot see; errors about parts
 * of an issue it did answer mark it incomplete.
 */
function readIssueNode(
  node: unknown,
  errors: readonly GraphqlError[],
  headers: ResponseHeaders,
): GitHubResult<Issue> {
  if (node === null || node === undefined) {
    return {
      ok: false,
      error:
        errors.length > 0
          ? graphqlError(errors, headers)
          : {
              kind: "unavailable",
              message: "Issue unavailable or not accessible with this account.",
              access: undefined,
            },
    };
  }
  const incomplete =
    errors.length > 0 ? graphqlError(errors, headers) : undefined;
  const issue = readIssue(node, incomplete);
  if (issue) return { ok: true, value: issue };
  return {
    ok: false,
    error: incomplete ?? { kind: "unexpected-response" },
  };
}

/**
 * Reads one issue node, or `undefined` if it is not one. When GitHub
 * reported errors about parts of it, which it answers with `null`, those
 * parts are left out and the issue is marked incomplete.
 */
function readIssue(
  node: unknown,
  incomplete: GitHubError | undefined,
): Issue | undefined {
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
  const partial = incomplete !== undefined;
  const labelList = readNodes(labels, readLabel, partial);
  const subIssueList = readNodes(subIssues, readReference, partial);
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
    incomplete,
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

/**
 * Reads a connection's `nodes`, or `undefined` if any is unreadable. Nodes
 * GitHub answered with `null` for errors it reported are left out.
 */
function readNodes<T>(
  connection: unknown,
  read: (node: unknown) => T | undefined,
  partial = false,
): T[] | undefined {
  if (!isObject(connection) || !Array.isArray(connection.nodes)) {
    return undefined;
  }
  const values: T[] = [];
  for (const node of connection.nodes as unknown[]) {
    if (partial && node === null) continue;
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

/** A GraphQL answer with data, and the errors GitHub reported alongside. */
interface GraphqlAnswer {
  viewerLogin: string;
  data: unknown;
  errors: GraphqlError[];
  headers: ResponseHeaders;
}

/**
 * An error GitHub reports with a GraphQL response. Its `path` names the part
 * of the query it concerns, e.g. an alias, and its `type` what went wrong.
 */
interface GraphqlError {
  message: string;
  type?: string;
  path?: (string | number)[];
  extensions?: { saml_failure?: unknown };
}

/** The errors about a part of a GraphQL answer, or about anything in it. */
function errorsAbout(
  errors: readonly GraphqlError[],
  path: readonly (string | number)[],
): GraphqlError[] {
  return errors.filter((error) =>
    path.every((key, index) => error.path?.[index] === key),
  );
}

/**
 * GraphQL's answer at HTTP 200 to a query GitHub timed out on. It gives no
 * error type.
 */
const graphqlTimeout = /^Something went wrong while executing your query/;

/** The domain error for errors GitHub reported with a GraphQL response. */
function graphqlError(
  errors: readonly GraphqlError[],
  headers: ResponseHeaders,
): GitHubError {
  const messages = errors.map((error) => error.message);
  const rateLimited = errors.find((error) =>
    error.type?.startsWith("RATE_LIMIT"),
  );
  if (rateLimited)
    return { kind: "rate-limited", message: rateLimited.message };
  const denied = errors.find(
    (error) => error.type === "NOT_FOUND" || error.type === "FORBIDDEN",
  );
  if (denied) {
    const saml = errors.some(
      (error) => error.extensions?.saml_failure === true,
    );
    return {
      kind: "unavailable",
      message: denied.message,
      access: accessEvidence(messages, headers, saml),
    };
  }
  const timedOut = errors.find((error) => graphqlTimeout.test(error.message));
  if (timedOut) return { kind: "server-error", message: timedOut.message };
  return { kind: "graphql", messages };
}

/**
 * The domain error for an HTTP error status. GitHub answers a rate limit with
 * 403 or 429 and says so in its headers or message; any other 403, 404 or
 * 410 means it will not show this account what was asked for.
 */
function httpError(
  status: number,
  message: string,
  headers: ResponseHeaders,
): GitHubError {
  const rateLimited =
    (status === 403 || status === 429) &&
    (headers.get("x-ratelimit-remaining") === "0" ||
      headers.has("retry-after") ||
      /rate limit/i.test(message));
  if (rateLimited) return { kind: "rate-limited", message };
  if (status === 403 || status === 404 || status === 410) {
    return {
      kind: "unavailable",
      message,
      access: accessEvidence([message], headers, false),
    };
  }
  if (status >= 500) return { kind: "server-error", message };
  return { kind: "http", status, message };
}

/**
 * Why GitHub would not show something to this account, when its answer says
 * so: SAML single sign-on, by its `X-GitHub-SSO` header (which carries the
 * link to authorize), by a GraphQL error's `saml_failure` or by its message;
 * or an organization's OAuth App access restrictions, by the message.
 */
function accessEvidence(
  messages: readonly string[],
  headers: ResponseHeaders,
  saml: boolean,
): AccessEvidence | undefined {
  const ssoRequired = /^required; url=(https:\/\/\S+)/.exec(
    headers.get("x-github-sso") ?? "",
  );
  const samlMessage = messages.find((message) =>
    /\bSAML enforcement\b/.test(message),
  );
  if (ssoRequired || saml || samlMessage !== undefined) {
    return {
      kind: "sso",
      message: samlMessage ?? messages[0] ?? "",
      url: ssoRequired?.[1],
    };
  }
  const restricted = messages.find((message) =>
    /\bOAuth App access restrictions\b/.test(message),
  );
  if (restricted !== undefined) {
    return { kind: "organization-approval", message: restricted };
  }
  return undefined;
}

/** Response headers, by lower-case name. */
type ResponseHeaders = ReadonlyMap<string, string>;

interface HttpResponse {
  status: number;
  headers: ResponseHeaders;
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
  const headers = new Map<string, string>();
  const headerLines = output.slice(statusLine[0].length, separator.index);
  for (const line of headerLines.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      headers.set(
        line.slice(0, colon).trim().toLowerCase(),
        line.slice(colon + 1).trim(),
      );
    }
  }
  return {
    status: Number(statusLine[1]),
    headers,
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

function readActor(node: unknown): IssueActor | undefined {
  if (
    !isObject(node) ||
    typeof node.login !== "string" ||
    typeof node.avatarUrl !== "string"
  )
    return undefined;
  return { login: node.login, avatarUrl: node.avatarUrl };
}

/**
 * Reads the metadata of an issue node, or `undefined` if it is not one;
 * `partial` when GitHub reported errors about parts of it.
 */
function readMetadata(
  node: unknown,
  partial: boolean,
): IssueMetadata | undefined {
  if (!isObject(node)) return undefined;
  const { stateReason, createdAt, author, milestone, comments } = node;
  const reasons = {
    COMPLETED: "completed",
    NOT_PLANNED: "not-planned",
    REOPENED: "reopened",
    DUPLICATE: "duplicate",
  } as const;
  if (
    stateReason !== null &&
    !(typeof stateReason === "string" && Object.hasOwn(reasons, stateReason))
  )
    return undefined;
  const assignees = readNodes(node.assignees, readActor, partial);
  const readAuthor = author === null ? null : readActor(author);
  const milestoneTitle =
    milestone === null
      ? null
      : isObject(milestone)
        ? milestone.title
        : undefined;
  if (
    typeof createdAt !== "string" ||
    !assignees ||
    readAuthor === undefined ||
    (milestoneTitle !== null && typeof milestoneTitle !== "string") ||
    !isObject(comments) ||
    typeof comments.totalCount !== "number"
  )
    return undefined;
  return {
    stateReason:
      stateReason === null
        ? undefined
        : reasons[stateReason as keyof typeof reasons],
    createdAt,
    author: readAuthor ?? undefined,
    assignees,
    milestone: milestoneTitle ?? undefined,
    commentCount: comments.totalCount,
  };
}
