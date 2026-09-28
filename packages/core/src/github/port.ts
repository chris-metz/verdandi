import type {
  AccessEvidence,
  BlockingSide,
  IssueComment,
  IssueMetadata,
  Label,
  RateLimitPool,
  RepositoryAddress,
  TokenSource,
} from "../contract.ts";

/**
 * The GitHub-access port. Every GitHub read the core makes goes through it,
 * and each method is exactly one GitHub request, so the core's request queue
 * can schedule and count them. Each read answers with what GitHub said of
 * the budget left in its rate-limit pool, which `readPools` names.
 */
export interface GitHubAccess {
  /**
   * Asks gh whether its credentials for github.com work, as `gh auth
   * status` does: gh asks GitHub with them. It fails when that cannot be
   * confirmed either way, e.g. without a connection.
   */
  fetchAuthStatus(): Promise<GitHubResult<AuthStatus>>;
  /** Reads one page of a blocking relationship list, including closed issues. */
  fetchRelationships(
    issueId: string,
    side: BlockingSide,
    after?: string,
    first?: number,
  ): Promise<GitHubResponse<RelationshipPage>>;
  /** Reads a single issue with the metadata shown on its page. */
  fetchIssueDetails(id: string): Promise<GitHubResponse<Issue & IssueMetadata>>;
  /**
   * Reads one page of an issue's comments, oldest first: the first 100, or
   * those after the `after` cursor of the previous page.
   */
  fetchIssueComments(
    issueId: string,
    after?: string,
  ): Promise<GitHubResponse<CommentPage>>;
  /**
   * Reads the HTML GitHub renders for up to 100 bodies, of issues or
   * comments, by node ID, with freshly signed links to their media. A body
   * GitHub cannot resolve or read gets its own error, in its place among
   * the others, which are still read.
   */
  fetchBodyHtml(
    ids: readonly string[],
  ): Promise<GitHubResponse<GitHubResult<string>[]>>;
  /**
   * Reads what a repository numbers so, following renames: an issue, or a
   * pull request, which shares their numbers.
   */
  fetchIssueByNumber(
    repository: RepositoryAddress,
    number: number,
  ): Promise<GitHubResponse<NumberedItem>>;
  /**
   * Reads one page of a repository's open issues, newest first: the first
   * page, or the one after the `after` cursor of the previous page. Each page
   * also counts the repository's closed issues, without reading them.
   */
  fetchOpenIssues(
    repository: RepositoryAddress,
    after?: string,
  ): Promise<GitHubResponse<IssuePage>>;
  /**
   * Reads up to 100 issues by node ID, from any repositories, e.g. closed
   * sub-issues or the parent issue of an issue already read. An issue GitHub
   * cannot resolve or read gets its own error, in its place among the
   * others, which are still read.
   */
  fetchIssues(
    ids: readonly string[],
  ): Promise<GitHubResponse<GitHubResult<Issue>[]>>;
  /**
   * Reads what the sidebar shows of up to 100 repositories, without reading
   * any issues. GitHub follows renames and transfers. A repository GitHub
   * cannot resolve or read gets its own error, in its place among the
   * others, which are still read.
   */
  fetchRepositorySummaries(
    repositories: readonly RepositoryAddress[],
  ): Promise<GitHubResponse<GitHubResult<RepositorySummary>[]>>;
}

/** Every rate-limit pool, in the order they are listed. */
export const rateLimitPools: readonly RateLimitPool[] = [
  "graphql",
  "core",
  "search",
];

/** The port's reads of GitHub, as opposed to checking gh's credentials. */
export type GitHubRead = Exclude<keyof GitHubAccess, "fetchAuthStatus">;

/** The rate-limit pool each read draws on. */
export const readPools: Record<GitHubRead, RateLimitPool> = {
  fetchIssueDetails: "graphql",
  fetchRelationships: "graphql",
  fetchIssueComments: "graphql",
  fetchBodyHtml: "graphql",
  fetchIssueByNumber: "graphql",
  fetchOpenIssues: "graphql",
  fetchIssues: "graphql",
  fetchRepositorySummaries: "graphql",
};

/** What a read answers with when it succeeds. */
export type ReadValue<R extends GitHubRead> =
  Awaited<ReturnType<GitHubAccess[R]>> extends GitHubResponse<infer T>
    ? T
    : never;

/**
 * How much of a rate-limit pool's budget is left, as an answer from GitHub
 * reported it.
 */
export interface RateLimitBudget {
  pool: RateLimitPool;
  /** How many points the pool holds each time it resets. */
  limit: number;
  remaining: number;
  /** When GitHub resets the pool, in milliseconds since the epoch. */
  resetAt: number;
}

/**
 * GitHub's answer to one read, with the budget left in the pool it drew on,
 * and the login of the account GitHub answered as, if the answer said. Every
 * GraphQL answer names the account, unless GitHub failed it with an HTTP
 * error; REST answers never do.
 */
export type GitHubResponse<T> = GitHubResult<T> & {
  budget: RateLimitBudget | undefined;
  viewerLogin: string | undefined;
};

/** Whether gh has working credentials for github.com. */
export type AuthStatus =
  /** GitHub accepted them. */
  | { state: "signed-in"; login: string; tokenSource: TokenSource }
  /** gh has none for github.com. */
  | { state: "signed-out" }
  /** GitHub rejected them with HTTP 401, e.g. an expired or revoked token. */
  | {
      state: "rejected";
      /** The account they belong to, if gh knows it without GitHub. */
      login: string | undefined;
      tokenSource: TokenSource;
      message: string;
    };

export interface Issue {
  /** GitHub's node ID. */
  id: string;
  /** The repository it lives in. */
  repository: RepositoryAddress;
  number: number;
  title: string;
  state: "open" | "closed";
  /** Its page on github.com. */
  url: string;
  /** When it last changed, as an ISO 8601 timestamp. */
  updatedAt: string;
  labels: Label[];
  /** Its parent issue, if it has one. */
  parent: IssueReference | undefined;
  /** Its sub-issues, in GitHub's order. */
  subIssues: IssueReference[];
  /** GitHub's `subIssuesSummary`. */
  subIssuesSummary: { total: number; completed: number };
  /**
   * GitHub's `issueDependenciesSummary`: how many open issues block this one
   * and how many it blocks, and the totals including closed ones.
   */
  issueDependenciesSummary: {
    blockedBy: number;
    totalBlockedBy: number;
    blocking: number;
    totalBlocking: number;
  };
  /**
   * Why GitHub left out part of it, e.g. a sub-issue or its parent issue it
   * would not show, when it reported errors about them along with the rest.
   */
  incomplete: GitHubError | undefined;
}

/** Another issue as a relationship names it, without reading it. */
export interface IssueReference {
  id: string;
  repository: RepositoryAddress;
  number: number;
  title: string;
  state: "open" | "closed";
}

/** A repository as the sidebar needs it, read without its issues. */
export interface RepositorySummary {
  /** GitHub's numeric ID (`databaseId`), which survives renames. */
  id: number;
  /**
   * Its current address, which differs from the one asked for once it has
   * been renamed or transferred.
   */
  repository: RepositoryAddress;
  openIssueCount: number;
  hasIssuesEnabled: boolean;
  isArchived: boolean;
}

export interface IssuePage {
  issues: Issue[];
  /** How many closed issues the repository has. */
  closedIssueCount: number;
  /** The cursor to read the next page after, or none on the last page. */
  nextPage: string | undefined;
  /**
   * Why GitHub left out issues of the page, when it reported errors about
   * them along with the rest.
   */
  incomplete: GitHubError | undefined;
}

/** What a repository numbers: an issue, or a pull request. */
export type NumberedItem =
  | { kind: "issue"; issue: IssueReference; url: string }
  | { kind: "pull-request"; url: string };

export interface CommentPage {
  comments: IssueComment[];
  /** The cursor to read the next page after, or none on the last page. */
  nextPage: string | undefined;
}

export type GitHubResult<T> =
  { ok: true; value: T } | { ok: false; error: GitHubError };

export type GitHubError =
  /** There is no gh where it was found, e.g. it has been uninstalled since. */
  | { kind: "gh-not-found" }
  /** gh could not be started, e.g. it is no longer executable. */
  | { kind: "gh-unusable"; message: string }
  /**
   * gh has no credentials for github.com: it exited with code 4, asking to
   * log in, without asking GitHub.
   */
  | { kind: "gh-signed-out"; message: string }
  /**
   * gh exited without an HTTP response from GitHub, e.g. because it could
   * not reach GitHub.
   */
  | { kind: "gh-failed"; message: string }
  /**
   * GitHub would not show it to this account: HTTP 403, 404 or 410, or
   * GraphQL's NOT_FOUND or FORBIDDEN. It may not exist, or this account may
   * not read it; GitHub does not say which, unless `access` names why.
   */
  | { kind: "unavailable"; message: string; access: AccessEvidence | undefined }
  /**
   * The pool's budget is used up (GitHub's primary rate limit) until it
   * resets, when the answer's budget says.
   */
  | { kind: "rate-limited"; limit: "primary"; message: string }
  /**
   * GitHub asks to slow down (a secondary rate limit): to wait `retryAfter`
   * milliseconds, when it says how long.
   */
  | {
      kind: "rate-limited";
      limit: "secondary";
      message: string;
      retryAfter: number | undefined;
    }
  /**
   * GitHub failed to answer: a server error (HTTP 5xx), or a GraphQL query
   * that timed out. Asking again may succeed.
   */
  | { kind: "server-error"; message: string }
  /** GitHub answered with any other HTTP error status, e.g. 401. */
  | { kind: "http"; status: number; message: string }
  /** GitHub answered a GraphQL query with any other errors. */
  | { kind: "graphql"; messages: string[] }
  /** The response could not be read, e.g. it was not JSON. */
  | { kind: "unexpected-response" };

export interface RelationshipPage {
  issues: Issue[];
  nextPage: string | undefined;
  incomplete: GitHubError | undefined;
}
