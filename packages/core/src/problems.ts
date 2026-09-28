import type { Problem } from "./contract.ts";
import { describeGitHubError } from "./github/error-message.ts";
import type { GitHubError } from "./github/port.ts";

/**
 * What the user is told of a failed GitHub request: GitHub could not be
 * reached, would not show it, was rate-limited, or anything else, said in a
 * sentence.
 */
export function problemOf(error: GitHubError): Problem {
  switch (error.kind) {
    case "gh-failed":
      return { kind: "unreachable", message: error.message };
    case "unavailable":
      return { kind: "unavailable", access: error.access };
    case "rate-limited":
      return { kind: "rate-limited", message: error.message };
    case "gh-not-found":
    case "gh-unusable":
    case "gh-signed-out":
    case "server-error":
    case "http":
    case "graphql":
    case "unexpected-response":
      return { kind: "error", message: describeGitHubError(error) };
  }
}

/**
 * Whether GitHub failed in a way its servers may recover from on their own,
 * so that asking again at once may succeed: a server error or a GraphQL
 * query that timed out.
 */
export function isTransient(error: GitHubError): boolean {
  return error.kind === "server-error";
}
