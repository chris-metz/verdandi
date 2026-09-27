import type { RepositoryAddress } from "../contract.ts";

/**
 * The GitHub-access port. Every GitHub read the core makes goes through it,
 * and each method is exactly one GitHub request, so the core's request queue
 * can schedule and count them.
 */
export interface GitHubAccess {
  /** Reads the account GitHub answers as. */
  fetchViewer(): Promise<GitHubResult<Viewer>>;
  /**
   * Reads one page of a repository's open issues, newest first: the first
   * page, or the one after the `after` cursor of the previous page.
   */
  fetchOpenIssues(
    repository: RepositoryAddress,
    after?: string,
  ): Promise<GitHubResult<IssuePage>>;
}

export interface Viewer {
  login: string;
}

export interface Issue {
  /** GitHub's node ID. */
  id: string;
  number: number;
  title: string;
  state: "open" | "closed";
}

export interface IssuePage {
  issues: Issue[];
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
