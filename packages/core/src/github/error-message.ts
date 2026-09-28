import type { GitHubError } from "./port.ts";

/** A plain sentence saying why GitHub could not be read. */
export function describeGitHubError(error: GitHubError): string {
  switch (error.kind) {
    case "gh-not-found":
      return "GitHub CLI (gh) could not be found.";
    case "gh-unusable":
      return `GitHub CLI (gh) could not be started: ${error.message}`;
    case "gh-signed-out":
      return "GitHub CLI (gh) is not signed in to github.com.";
    case "gh-failed":
      return `GitHub CLI (gh) failed: ${error.message}`;
    case "http":
      return `GitHub answered with HTTP ${String(error.status)}: ${error.message}`;
    case "graphql":
      return `GitHub reported an error: ${error.messages.join(" ")}`;
    case "unexpected-response":
      return "GitHub sent a response Verdandi could not read.";
  }
}
