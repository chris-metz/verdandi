import type { Problem } from "./contract.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { GitHubError } from "./github/port.ts";
import type { RequestError } from "./request-queue.ts";

/**
 * What the user is told of a request that failed: GitHub could not be
 * reached, would not show it, or anything else, said in a sentence; or it
 * was interrupted as its screen was left. A rate limit is never told here:
 * the request queue holds a rate-limited request back until GitHub lets it
 * through.
 */
export function problemOf(error: RequestError): Problem {
  switch (error.kind) {
    case "interrupted":
      return { kind: "interrupted" };
    case "gh-failed":
      return { kind: "unreachable", message: error.message };
    case "unavailable":
      return { kind: "unavailable", access: error.access };
    case "gh-not-found":
    case "gh-unusable":
    case "gh-signed-out":
    case "rate-limited":
    case "server-error":
    case "http":
    case "invalid-search":
    case "graphql":
    case "unexpected-response":
      return { kind: "error", message: describeGitHubError(error) };
  }
}

/** A plain sentence saying why a request failed. */
export function describeRequestError(error: RequestError): string {
  return error.kind === "interrupted"
    ? "It was not read, since nothing on screen needed it any more."
    : describeGitHubError(error);
}

/**
 * Whether GitHub failed in a way its servers may recover from on their own,
 * so that asking again at once may succeed: a server error or a GraphQL
 * query that timed out.
 */
export function isTransient(error: GitHubError): boolean {
  return error.kind === "server-error";
}
