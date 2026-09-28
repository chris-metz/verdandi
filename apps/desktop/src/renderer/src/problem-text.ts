import type { Problem } from "@verdandi/core/contract";

/** How the window says why something could not be read. */
export interface ProblemText {
  /** A short sentence, e.g. "Cannot reach GitHub". */
  text: string;
  /** More, in GitHub's or gh's own words, e.g. for a tooltip. */
  detail: string | undefined;
  /** Where to act on it, only when GitHub gave the link, e.g. to authorize SSO. */
  link: { label: string; url: string } | undefined;
}

/**
 * What the window says of a problem. What GitHub will not show is
 * "unavailable or not accessible", never deleted or missing a permission:
 * a specific reason, and a link, come only from GitHub's answer.
 */
export function problemText(problem: Problem, login?: string): ProblemText {
  switch (problem.kind) {
    case "unreachable":
      return {
        text: "Cannot reach GitHub",
        detail: problem.message,
        link: undefined,
      };
    case "unavailable": {
      const { access } = problem;
      const account = login === undefined ? "" : ` (@${login})`;
      return {
        text: `Unavailable or not accessible with this account${account}`,
        detail: access?.message,
        link:
          access?.kind === "sso" && access.url !== undefined
            ? { label: "Authorize on GitHub", url: access.url }
            : undefined,
      };
    }
    case "interrupted":
      return {
        text: "Loading was interrupted",
        detail: undefined,
        link: undefined,
      };
    case "error":
      return { text: problem.message, detail: undefined, link: undefined };
  }
}
