import type { IssueMetadata, Label, RepositoryAddress } from "../contract.ts";

/**
 * The GitHub-access port. Every GitHub read the core makes goes through it,
 * and each method is exactly one GitHub request, so the core's request queue
 * can schedule and count them.
 */
export interface GitHubAccess {
  /** Reads a single issue with the metadata shown on its page. */
  fetchIssueDetails(id: string): Promise<GitHubResult<Issue & IssueMetadata>>;
  /** Reads the account GitHub answers as. */
  fetchViewer(): Promise<GitHubResult<Viewer>>;
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
   * sub-issues or the parent issue of an issue already read.
   */
  fetchIssues(ids: readonly string[]): Promise<GitHubResult<Issue[]>>;
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
  send: (github: GitHubAccess) => Promise<T>,
) => Promise<T>;

export interface Viewer {
  login: string;
}

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
}

export type GitHubResult<T> =
  { ok: true; value: T } | { ok: false; error: GitHubError };

export type GitHubError =
  /** `gh` is not on PATH. */
  | { kind: "gh-not-found" }
  /** `gh` could not start, or exited without an HTTP response from GitHub. */
  | { kind: "gh-failed"; message: string }
  /** GitHub answered with an HTTP error status. */
  | { kind: "http"; status: number; message: string }
  /** GitHub answered a GraphQL query with errors. */
  | { kind: "graphql"; messages: string[] }
  /** The response could not be read, e.g. it was not JSON. */
  | { kind: "unexpected-response" };
