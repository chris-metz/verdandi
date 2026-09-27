/**
 * The GitHub-access port. Every GitHub read the core makes goes through it,
 * and each method is exactly one GitHub request, so the core's request queue
 * can schedule and count them.
 */
export interface GitHubAccess {
  /** Reads the account GitHub answers as. */
  fetchViewer(): Promise<GitHubResult<Viewer>>;
}

export interface Viewer {
  login: string;
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
