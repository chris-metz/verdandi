import type {
  AccessEvidence,
  IssueActor,
  IssueComment,
  IssueMetadata,
  Label,
  RateLimitPool,
} from "../contract.ts";
import { isObject } from "../json.ts";
import { parseRepositoryAddress } from "../repository-address.ts";
import type { CommandResult, CommandRunner } from "./command-runner.ts";
import {
  rateLimitPools,
  searchPageSize,
  type AuthStatus,
  type CommentPage,
  type GitHubAccess,
  type GitHubError,
  type GitHubResponse,
  type GitHubResult,
  type Issue,
  type IssuePage,
  type IssueReference,
  type NumberedItem,
  type RateLimitBudget,
  type RepositoryAccess,
  type RepositorySummary,
  type SearchMatch,
  type SearchPage,
  type SuggestionPage,
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

/** The most comments GitHub returns in one page. */
const commentsPerPage = 100;

/**
 * How GitHub rejects a search naming repositories or users it cannot
 * search, rather than its syntax: "The listed users and repositories cannot
 * be searched either because the resources do not exist or you do not have
 * permission to view them."
 */
const unsearchable = /\busers and repositories cannot be searched\b/i;

/**
 * An issue GitHub left out of its answer without saying why, as it may for
 * one this account cannot see.
 */
const issueUnavailable: GitHubError = {
  kind: "unavailable",
  message: "Issue unavailable or not accessible with this account.",
  access: undefined,
};

/**
 * A body GitHub left out of its answer without saying why, as it may for a
 * comment that was deleted.
 */
const bodyUnavailable: GitHubError = {
  kind: "unavailable",
  message: "Body unavailable or not accessible with this account.",
  access: undefined,
};

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

/**
 * What the picker reads of a repository: whether an organization owns it,
 * and whether its issues can be read. Their count is read only to learn
 * whether GitHub refuses them, as it does a token without Issues access.
 */
const repositoryAccessFields = `
  databaseId nameWithOwner owner { __typename } hasIssuesEnabled isArchived
  issues(states: OPEN) { totalCount }
`;

/** The most repositories or organizations GitHub returns in one page. */
const suggestionsPerPage = 100;

/**
 * The repositories the picker suggests: owned, collaborated on, or reached
 * as an organization member (GitHub's `ownerAffiliations` leaves out the
 * last by default), most recently pushed first.
 */
const suggestionsConnection = `repositories(
  first: ${String(suggestionsPerPage)}, after: $after,
  affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
  ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
  orderBy: {field: PUSHED_AT, direction: DESC}
)`;

/**
 * The budget left in GraphQL's pool, which GitHub answers with every query
 * without charging for it.
 */
const rateLimitSelection = "rateLimit { limit remaining resetAt }";

/** The GitHub-access port implemented with `gh api`. */
export function createGhAdapter({
  runCommand,
  gh,
}: GhAdapterOptions): GitHubAccess {
  /**
   * Runs one GraphQL query, keeping the data GitHub sends at HTTP 200
   * alongside errors about parts of the query, such as a repository it
   * cannot resolve, for `read` to place. Errors fail it only when there is
   * no data. Every query also reads `viewer { login }`, and the budget left
   * in GraphQL's pool, which the answer carries. Values reach GitHub as
   * typed variables, never spliced into the query.
   */
  async function graphql<T>(
    selection: string,
    variables: Variables,
    read: (answer: GraphqlAnswer) => GitHubResult<T>,
  ): Promise<GitHubResponse<T>> {
    const entries = Object.entries(variables);
    const declarations = entries.map(([name, { type }]) => `$${name}: ${type}`);
    const operation = entries.length
      ? `query(${declarations.join(", ")})`
      : "query";
    const query = `${operation} { viewer { login } ${rateLimitSelection} ${selection} }`;
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
    if (result.kind !== "exited") return failed(runFailure(result));
    const response = parseTranscript(result.stdout);
    if (!response) return failed(exitFailure(result));
    const { status, headers } = response;
    const body =
      status >= 400
        ? undefined
        : (parseJson(response.body) as GraphqlBody | undefined);
    const budget =
      budgetFromRateLimit(body?.data?.rateLimit) ??
      budgetFromHeaders(headers, "graphql");
    if (status >= 400) {
      const message = readMessage(response.body) ?? `HTTP ${String(status)}`;
      return failed(httpError(status, message, headers), budget);
    }
    const errors = body?.errors ?? [];
    const viewerLogin = body?.data?.viewer?.login;
    if (typeof viewerLogin !== "string") {
      return failed(
        errors.length > 0
          ? graphqlError(errors, headers)
          : { kind: "unexpected-response" },
        budget,
      );
    }
    return {
      ...read({ data: body?.data, errors, headers }),
      budget,
      viewerLogin,
    };
  }

  return {
    async searchIssues(query, page) {
      // `-f` passes the search as a plain string, whatever it starts with.
      const result = await runCommand(gh, [
        "api",
        "--method",
        "GET",
        "--hostname",
        "github.com",
        "--include",
        "search/issues",
        "-f",
        `q=${query}`,
        "-f",
        "advanced_search=true",
        "-f",
        `per_page=${String(searchPageSize)}`,
        "-f",
        `page=${String(page)}`,
      ]);
      if (result.kind !== "exited") return failed(runFailure(result));
      const response = parseTranscript(result.stdout);
      if (!response) return failed(exitFailure(result));
      const { status, headers, body } = response;
      const budget = budgetFromHeaders(headers, "search");
      if (status === 422) {
        const message = readValidationMessage(body) ?? "Validation Failed";
        return failed(
          {
            kind: "invalid-search",
            message,
            unsearchable: unsearchable.test(message),
          },
          budget,
        );
      }
      if (status >= 500 && body.trim() === "") {
        return failed(
          {
            kind: "server-error",
            message: `HTTP ${String(status)}`,
            emptyBody: true,
          },
          budget,
        );
      }
      if (status >= 400) {
        const message = readMessage(body) ?? `HTTP ${String(status)}`;
        return failed(httpError(status, message, headers), budget);
      }
      const matches = readSearchPage(parseJson(body));
      return matches
        ? { ok: true, value: matches, budget, viewerLogin: undefined }
        : failed({ kind: "unexpected-response" }, budget);
    },
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
    fetchIssueDetails(id) {
      return graphql(
        `node(id: $id) { ... on Issue {
          ${issueFields}
          stateReason createdAt
          author { login avatarUrl }
          assignees(first: 100) { nodes { login avatarUrl } }
          milestone { title }
          comments { totalCount }
          bodyHTML
        } }`,
        { id: { type: "ID!", value: id } },
        ({ data, errors, headers }) => {
          const node = isObject(data) ? data.node : undefined;
          const read = readIssueNode(
            node,
            errorsAbout(errors, ["node"]),
            headers,
          );
          if (!read.ok) return read;
          const metadata = readMetadata(
            node,
            read.value.incomplete !== undefined,
          );
          if (!metadata) {
            return { ok: false, error: { kind: "unexpected-response" } };
          }
          return { ok: true, value: { ...read.value, ...metadata } };
        },
      );
    },
    fetchRelationships(issueId, side, after, first = 100) {
      return graphql(
        `node(id: $id) { ... on Issue {
          ${side}(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { ${issueFields} }
          }
        } }`,
        {
          id: { type: "ID!", value: issueId },
          first: { type: "Int!", value: first },
          after: { type: "String", value: after },
        },
        ({ data, errors, headers }) => {
          const node = isObject(data) ? data.node : undefined;
          const connection = isObject(node) ? node[side] : undefined;
          const info = isObject(connection) ? connection.pageInfo : undefined;
          const nodes = isObject(connection) ? connection.nodes : undefined;
          if (
            !isObject(info) ||
            typeof info.hasNextPage !== "boolean" ||
            !Array.isArray(nodes) ||
            (info.hasNextPage && typeof info.endCursor !== "string")
          ) {
            return {
              ok: false,
              error: errors.length
                ? graphqlError(errors, headers)
                : node == null
                  ? issueUnavailable
                  : { kind: "unexpected-response" },
            };
          }
          const issues: Issue[] = [];
          let incomplete = errors.length
            ? graphqlError(errors, headers)
            : undefined;
          for (const [index, value] of nodes.entries()) {
            const read = readIssueNode(
              value,
              errorsAbout(errors, ["node", side, "nodes", index]),
              headers,
            );
            if (read.ok) issues.push(read.value);
            else incomplete ??= read.error;
          }
          return {
            ok: true,
            value: {
              issues,
              incomplete,
              nextPage: info.hasNextPage ? String(info.endCursor) : undefined,
            },
          };
        },
      );
    },
    fetchIssueComments(issueId, after) {
      return graphql(
        // Only comments: GitHub's timeline events are left out.
        `node(id: $id) { ... on Issue {
          comments(first: ${String(commentsPerPage)}, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { id url createdAt bodyHTML author { login avatarUrl } }
          }
        } }`,
        {
          id: { type: "ID!", value: issueId },
          after: { type: "String", value: after },
        },
        ({ data, errors, headers }) => {
          const node = isObject(data) ? data.node : undefined;
          if (node === null || node === undefined) {
            const aboutIt = errorsAbout(errors, ["node"]);
            return {
              ok: false,
              error:
                aboutIt.length > 0
                  ? graphqlError(aboutIt, headers)
                  : issueUnavailable,
            };
          }
          const page = readCommentPage(node);
          if (page) return { ok: true, value: page };
          return {
            ok: false,
            error:
              errors.length > 0
                ? graphqlError(errors, headers)
                : { kind: "unexpected-response" },
          };
        },
      );
    },
    fetchBodyHtml(ids) {
      return graphql(
        `nodes(ids: $ids) {
          ... on Issue { bodyHTML }
          ... on IssueComment { bodyHTML }
        }`,
        { ids: { type: "[ID!]!", value: ids } },
        ({ data, errors, headers }) => {
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
          // Each body is GitHub's answer in its place, whatever the others'.
          return {
            ok: true,
            value: ids.map((_, index): GitHubResult<string> => {
              const node = (nodes as unknown[])[index];
              if (isObject(node) && typeof node.bodyHTML === "string") {
                return { ok: true, value: node.bodyHTML };
              }
              const aboutIt = errorsAbout(errors, ["nodes", index]);
              if (aboutIt.length > 0) {
                return { ok: false, error: graphqlError(aboutIt, headers) };
              }
              return {
                ok: false,
                error:
                  node === null || node === undefined
                    ? bodyUnavailable
                    : { kind: "unexpected-response" },
              };
            }),
          };
        },
      );
    },
    fetchIssueByNumber({ owner, name }, number) {
      return graphql(
        `repository(owner: $owner, name: $name) {
          issueOrPullRequest(number: $number) {
            __typename
            ... on Issue { ${referenceFields} url }
            ... on PullRequest { url }
          }
        }`,
        {
          owner: { type: "String!", value: owner },
          name: { type: "String!", value: name },
          number: { type: "Int!", value: number },
        },
        ({ data, errors, headers }) => {
          const found = readNumberedItem(data);
          if (found) return { ok: true, value: found };
          // GitHub resolved neither the repository nor the number in it.
          const aboutIt = errorsAbout(errors, ["repository"]);
          return {
            ok: false,
            error:
              aboutIt.length > 0
                ? graphqlError(aboutIt, headers)
                : issueUnavailable,
          };
        },
      );
    },
    fetchOpenIssues({ owner, name }, after) {
      return graphql(
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
        ({ data, errors, headers }) => {
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
      );
    },
    fetchIssues(ids) {
      return graphql(
        `nodes(ids: $ids) { ... on Issue { ${issueFields} } }`,
        { ids: { type: "[ID!]!", value: ids } },
        ({ data, errors, headers }) => {
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
      );
    },
    fetchRepositorySummaries(repositories) {
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
      return graphql(
        selections.join("\n"),
        variables,
        ({ data, errors, headers }) => ({
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
        }),
      );
    },
    fetchRepositoryAccess(repositories) {
      // One aliased `repository` per repository, as for summaries.
      const variables: Variables = {};
      const selections = repositories.map(({ owner, name }, index) => {
        const n = String(index);
        variables[`owner${n}`] = { type: "String!", value: owner };
        variables[`name${n}`] = { type: "String!", value: name };
        return `r${n}: repository(owner: $owner${n}, name: $name${n}) {
          ${repositoryAccessFields}
        }`;
      });
      return graphql(
        selections.join("\n"),
        variables,
        ({ data, errors, headers }) => ({
          ok: true,
          value: repositories.map((_, index) => {
            const alias = `r${String(index)}`;
            const node = isObject(data) ? data[alias] : undefined;
            return (
              readRepositoryAccess(node, errors, [alias], headers) ?? {
                ok: false,
                error: errorAbout(errors, [alias], headers),
              }
            );
          }),
        }),
      );
    },
    fetchRepositorySuggestions(after) {
      const organizations =
        after === undefined
          ? `organizations(first: ${String(suggestionsPerPage)}) { nodes { login } }`
          : "";
      return graphql(
        `me: viewer {
          ${organizations}
          ${suggestionsConnection} {
            pageInfo { hasNextPage endCursor }
            nodes { ${repositoryAccessFields} }
          }
        }`,
        { after: { type: "String", value: after ?? null } },
        ({ data, errors, headers }) => {
          const page = readSuggestionPage(data, errors, headers, {
            withOrganizations: after === undefined,
          });
          return page
            ? { ok: true, value: page }
            : { ok: false, error: errorAbout(errors, ["me"], headers) };
        },
      );
    },
  };
}

/**
 * The domain error GitHub reported about a part of a GraphQL answer it left
 * out, or an unexpected response when it reported none.
 */
function errorAbout(
  errors: readonly GraphqlError[],
  path: readonly (string | number)[],
  headers: ResponseHeaders,
): GitHubError {
  const aboutIt = errorsAbout(errors, path);
  return aboutIt.length > 0
    ? graphqlError(aboutIt, headers)
    : { kind: "unexpected-response" };
}

/**
 * Reads a repository as the picker checks it, at `path` in the answer, or
 * `undefined` if it is not one. GitHub refusing its issues while showing the
 * repository is kept as why; any other error about them fails it.
 */
function readRepositoryAccess(
  node: unknown,
  errors: readonly GraphqlError[],
  path: readonly (string | number)[],
  headers: ResponseHeaders,
): GitHubResult<RepositoryAccess> | undefined {
  if (!isObject(node)) return undefined;
  const {
    databaseId,
    nameWithOwner,
    owner,
    hasIssuesEnabled,
    isArchived,
    issues,
  } = node;
  const repository =
    typeof nameWithOwner === "string"
      ? parseRepositoryAddress(nameWithOwner)
      : undefined;
  const ownerType = isObject(owner) ? owner.__typename : undefined;
  const issuesRead = isObject(issues) && typeof issues.totalCount === "number";
  const aboutIssues = errorsAbout(errors, [...path, "issues"]);
  if (
    typeof databaseId !== "number" ||
    !repository ||
    typeof ownerType !== "string" ||
    typeof hasIssuesEnabled !== "boolean" ||
    typeof isArchived !== "boolean" ||
    (!issuesRead && aboutIssues.length === 0)
  ) {
    return undefined;
  }
  const issuesError = issuesRead
    ? undefined
    : graphqlError(aboutIssues, headers);
  // Only a refusal says the issues cannot be read; anything else, such as a
  // timeout, says nothing of them, and fails the check.
  if (issuesError && issuesError.kind !== "unavailable") {
    return { ok: false, error: issuesError };
  }
  return {
    ok: true,
    value: {
      id: databaseId,
      repository,
      ownedByOrganization: ownerType === "Organization",
      hasIssuesEnabled,
      isArchived,
      issuesDenied: issuesError,
    },
  };
}

/**
 * Reads a page of the picker's suggestions, or `undefined` if it is not
 * one. Repositories GitHub reported errors about instead of answering are
 * left out, with the errors.
 */
function readSuggestionPage(
  data: unknown,
  errors: readonly GraphqlError[],
  headers: ResponseHeaders,
  { withOrganizations }: { withOrganizations: boolean },
): SuggestionPage | undefined {
  if (!isObject(data) || !isObject(data.me) || !isObject(data.viewer)) {
    return undefined;
  }
  const { login } = data.viewer;
  const { repositories, organizations } = data.me;
  if (typeof login !== "string" || !isObject(repositories)) return undefined;
  const { pageInfo, nodes } = repositories;
  if (!isObject(pageInfo) || !Array.isArray(nodes)) return undefined;
  const { hasNextPage, endCursor } = pageInfo;
  if (typeof hasNextPage !== "boolean") return undefined;
  if (hasNextPage && typeof endCursor !== "string") return undefined;
  const incomplete: GitHubError[] = [];
  const read: RepositoryAccess[] = [];
  for (const [index, node] of nodes.entries()) {
    const path = ["me", "repositories", "nodes", index];
    const access = readRepositoryAccess(node, errors, path, headers);
    if (access?.ok) read.push(access.value);
    else incomplete.push(errorAbout(errors, path, headers));
  }
  let logins: string[] | undefined;
  if (withOrganizations) {
    const members =
      isObject(organizations) && Array.isArray(organizations.nodes)
        ? organizations.nodes
        : [];
    logins = members.flatMap((member) =>
      isObject(member) && typeof member.login === "string"
        ? [member.login]
        : [],
    );
    if (!isObject(organizations)) {
      incomplete.push(errorAbout(errors, ["me", "organizations"], headers));
    }
  }
  return {
    account: login,
    organizations: logins,
    repositories: read,
    nextPage: hasNextPage ? (endCursor as string) : undefined,
    incomplete,
  };
}

/**
 * A read that failed without GitHub naming the account it answered as, with
 * the budget left, if GitHub said.
 */
function failed(
  error: GitHubError,
  budget?: RateLimitBudget,
): GitHubResponse<never> {
  return { ok: false, error, budget, viewerLogin: undefined };
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
        errors.length > 0 ? graphqlError(errors, headers) : issueUnavailable,
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
  data?: { viewer?: { login?: unknown }; rateLimit?: unknown } | null;
  errors?: GraphqlError[];
}

/** A GraphQL answer with data, and the errors GitHub reported alongside. */
interface GraphqlAnswer {
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
  if (rateLimited) {
    return rateLimitError(rateLimited.message, headers, "graphql");
  }
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
  if (rateLimited) return rateLimitError(message, headers, "http");
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
 * A rate limit GitHub answered with: primary once the pool's budget is used
 * up, and secondary otherwise, with how long GitHub asks to wait when it
 * says. GraphQL's own rate-limit error, at HTTP 200, is primary unless it
 * says otherwise, also when a query costs more than is left; at an HTTP error
 * status, the headers say whether the budget is used up.
 */
function rateLimitError(
  message: string,
  headers: ResponseHeaders,
  answer: "graphql" | "http",
): GitHubError {
  const secondary =
    /\bsecondary rate limit\b/i.test(message) ||
    (answer === "http" && headers.get("x-ratelimit-remaining") !== "0");
  if (!secondary) return { kind: "rate-limited", limit: "primary", message };
  const seconds = /^\d+$/.exec(headers.get("retry-after") ?? "");
  return {
    kind: "rate-limited",
    limit: "secondary",
    message,
    retryAfter: seconds ? Number(seconds[0]) * 1000 : undefined,
  };
}

/**
 * The budget left in a pool, as GitHub's `x-ratelimit-*` headers report it;
 * in `pool` unless their `x-ratelimit-resource` names another.
 */
function budgetFromHeaders(
  headers: ResponseHeaders,
  pool: RateLimitPool,
): RateLimitBudget | undefined {
  const [limit, remaining, reset] = [
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
  ].map((name) => {
    const value = headers.get(name);
    return value !== undefined && /^\d+$/.test(value) ? Number(value) : NaN;
  });
  if (
    limit === undefined ||
    remaining === undefined ||
    reset === undefined ||
    [limit, remaining, reset].some(Number.isNaN)
  ) {
    return undefined;
  }
  const resource = headers.get("x-ratelimit-resource");
  const named =
    resource === undefined
      ? pool
      : rateLimitPools.find((known) => known === resource);
  if (named === undefined) return undefined;
  return { pool: named, limit, remaining, resetAt: reset * 1000 };
}

/** The budget left in GraphQL's pool, as a query's `rateLimit` reports it. */
function budgetFromRateLimit(value: unknown): RateLimitBudget | undefined {
  if (!isObject(value)) return undefined;
  const { limit, remaining, resetAt } = value;
  const reset = typeof resetAt === "string" ? Date.parse(resetAt) : NaN;
  if (
    typeof limit !== "number" ||
    typeof remaining !== "number" ||
    Number.isNaN(reset)
  ) {
    return undefined;
  }
  return { pool: "graphql", limit, remaining, resetAt: reset };
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

/**
 * What GitHub says of a search it rejected: the messages of its validation
 * errors, or else its own message.
 */
function readValidationMessage(body: string): string | undefined {
  const parsed = parseJson(body);
  const errors = isObject(parsed) ? parsed.errors : undefined;
  const messages = Array.isArray(errors)
    ? errors.flatMap((error) =>
        isObject(error) && typeof error.message === "string"
          ? [error.message]
          : [],
      )
    : [];
  return messages.length > 0 ? messages.join(" ") : readMessage(body);
}

/** Reads a page of a REST issue search, or `undefined` if it is not one. */
function readSearchPage(body: unknown): SearchPage | undefined {
  if (!isObject(body)) return undefined;
  const { total_count, incomplete_results, items } = body;
  if (
    typeof total_count !== "number" ||
    typeof incomplete_results !== "boolean" ||
    !Array.isArray(items)
  ) {
    return undefined;
  }
  const issues: SearchMatch[] = [];
  let pullRequests = 0;
  for (const item of items) {
    if (isObject(item) && item.pull_request != null) {
      pullRequests++;
      continue;
    }
    const issue = readSearchMatch(item);
    if (!issue) return undefined;
    issues.push(issue);
  }
  return {
    total: total_count,
    incomplete: incomplete_results,
    issues,
    pullRequests,
  };
}

/** Reads an issue a REST search matched, or `undefined` if it is not one. */
function readSearchMatch(item: unknown): SearchMatch | undefined {
  if (!isObject(item)) return undefined;
  const {
    node_id,
    number,
    title,
    state,
    html_url,
    repository_url,
    updated_at,
    labels,
    sub_issues_summary,
    issue_dependencies_summary,
    parent_issue_url,
  } = item;
  const repository =
    typeof repository_url === "string"
      ? parseRepositoryAddress(
          repository_url.replace(/^https:\/\/api\.github\.com\/repos\//, ""),
        )
      : undefined;
  const subIssues = readCounts(sub_issues_summary, ["total", "completed"]);
  const dependencies = readCounts(issue_dependencies_summary, [
    "blocked_by",
    "total_blocked_by",
    "blocking",
    "total_blocking",
  ]);
  const labelList = Array.isArray(labels) ? labels.map(readLabel) : undefined;
  if (
    typeof node_id !== "string" ||
    typeof number !== "number" ||
    typeof title !== "string" ||
    (state !== "open" && state !== "closed") ||
    typeof html_url !== "string" ||
    typeof updated_at !== "string" ||
    !repository ||
    !labelList ||
    labelList.some((label) => label === undefined)
  ) {
    return undefined;
  }
  return {
    id: node_id,
    repository,
    number,
    title,
    state,
    url: html_url,
    updatedAt: updated_at,
    labels: labelList as Label[],
    // GitHub leaves the pointer out of an issue without a parent issue.
    hasParent: typeof parent_issue_url === "string",
    // GitHub leaves out summaries it has not computed, e.g. for old issues.
    subIssuesSummary: subIssues ?? { total: 0, completed: 0 },
    issueDependenciesSummary: {
      blockedBy: dependencies?.blocked_by ?? 0,
      totalBlockedBy: dependencies?.total_blocked_by ?? 0,
      blocking: dependencies?.blocking ?? 0,
      totalBlocking: dependencies?.total_blocking ?? 0,
    },
  };
}

/**
 * Reads what a repository numbers, an issue or a pull request, or
 * `undefined` if it is neither.
 */
function readNumberedItem(data: unknown): NumberedItem | undefined {
  const repository = isObject(data) ? data.repository : undefined;
  const item = isObject(repository) ? repository.issueOrPullRequest : undefined;
  if (!isObject(item) || typeof item.url !== "string") return undefined;
  if (item.__typename === "PullRequest") {
    return { kind: "pull-request", url: item.url };
  }
  const issue = item.__typename === "Issue" ? readReference(item) : undefined;
  return issue && { kind: "issue", issue, url: item.url };
}

/** Reads a page of an issue's comments, or `undefined` if it is not one. */
function readCommentPage(node: unknown): CommentPage | undefined {
  const connection = isObject(node) ? node.comments : undefined;
  const pageInfo = isObject(connection) ? connection.pageInfo : undefined;
  const { hasNextPage, endCursor } = isObject(pageInfo) ? pageInfo : {};
  const comments = readNodes(connection, readComment);
  if (!comments || typeof hasNextPage !== "boolean") return undefined;
  let nextPage: string | undefined;
  if (hasNextPage) {
    if (typeof endCursor !== "string") return undefined;
    nextPage = endCursor;
  }
  return { comments, nextPage };
}

/** Reads a comment, or `undefined` if it is not one. */
function readComment(node: unknown): IssueComment | undefined {
  if (!isObject(node)) return undefined;
  const { id, url, createdAt, bodyHTML, author } = node;
  const readAuthor = author === null ? null : readActor(author);
  if (
    typeof id !== "string" ||
    typeof url !== "string" ||
    typeof createdAt !== "string" ||
    typeof bodyHTML !== "string" ||
    readAuthor === undefined
  ) {
    return undefined;
  }
  return { id, author: readAuthor ?? undefined, createdAt, url, bodyHTML };
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
  const { stateReason, createdAt, author, milestone, comments, bodyHTML } =
    node;
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
    typeof comments.totalCount !== "number" ||
    typeof bodyHTML !== "string"
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
    bodyHTML,
  };
}
