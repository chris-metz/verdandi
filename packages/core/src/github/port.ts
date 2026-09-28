import type {
  AccessEvidence,
  IssueMetadata,
  Label,
  RepositoryAddress,
  TokenSource,
} from "../contract.ts";

/**
 * The GitHub-access port. Every GitHub read the core makes goes through it,
 * and each method is exactly one GitHub request, so the core's request queue
 * can schedule and count them.
 */
export interface GitHubAccess {
  /**
   * Asks gh whether its credentials for github.com work, as `gh auth
   * status` does: gh asks GitHub with them. It fails when that cannot be
   * confirmed either way, e.g. without a connection.
   */
  fetchAuthStatus(): Promise<GitHubResult<AuthStatus>>;
  /** Reads a single issue with the metadata shown on its page. */
  fetchIssueDetails(id: string): Promise<GitHubResult<Issue & IssueMetadata>>;
  /**
   * Reads one page of a repository's open issues, newest first: the first
   * page, or the one after the `after` cursor of the previous page. Each page
   * also counts the repository's closed issues, without reading them.
   */
  fetchOpenIssues(
    repository: RepositoryAddress,
    after?: string,
  ): Promise<GitHubResult<IssuePage>>;
  /**
   * Reads up to 100 issues by node ID, from any repositories, e.g. closed
   * sub-issues or the parent issue of an issue already read. An issue GitHub
   * cannot resolve or read gets its own error, in its place among the
   * others, which are still read.
   */
  fetchIssues(
    ids: readonly string[],
  ): Promise<GitHubResult<GitHubResult<Issue>[]>>;
  /**
   * Reads what the sidebar shows of up to 100 repositories, without reading
   * any issues. GitHub follows renames and transfers. A repository GitHub
   * cannot resolve or read gets its own error, in its place among the
   * others, which are still read.
   */
  fetchRepositorySummaries(
    repositories: readonly RepositoryAddress[],
  ): Promise<GitHubResult<GitHubResult<RepositorySummary>[]>>;
}

/**
 * Sends one GitHub request through the core's request queue, which schedules
 * them all. The core's modules take this instead of the port itself.
 */
export type SendRequest = <T>(
  send: (github: GitHubAccess) => Promise<GitHubResult<T>>,
) => Promise<GitHubResult<T>>;

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
  /** GitHub's rate limit is reached, primary or secondary. */
  | { kind: "rate-limited"; message: string }
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
