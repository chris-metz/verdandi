import type { RepositoryAddress } from "@verdandi/core/contract";

/**
 * Where a link in an issue's body or comment leads, when it is clicked:
 *
 * - `issue`: a GitHub issue, which opens in the app, whether its repository
 *   is tracked or not (`#123`, `owner/repo#123` and issue URLs all link to
 *   one on github.com);
 * - `anchor`: an element in the same body, such as a footnote;
 * - `external`: any other `https://` address, which opens in the browser;
 * - `none`: anything else, which never opens.
 */
export type LinkTarget =
  | { kind: "issue"; repository: RepositoryAddress; number: number }
  | { kind: "anchor"; id: string }
  | { kind: "external"; url: string }
  | { kind: "none" };

/** A link to a GitHub issue. */
export type LinkToIssue = Extract<LinkTarget, { kind: "issue" }>;

/** An issue's page on github.com: `/owner/name/issues/number`. */
const issuePath = /^\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?$/;

/** Where a link leads, by its `href`. */
export function linkTarget(href: string): LinkTarget {
  if (href.startsWith("#")) {
    const id = href.slice(1);
    return id === "" ? { kind: "none" } : { kind: "anchor", id };
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { kind: "none" };
  }
  if (url.protocol !== "https:") return { kind: "none" };
  const onGitHub =
    url.hostname === "github.com" || url.hostname === "www.github.com";
  const issue = onGitHub ? issuePath.exec(url.pathname) : null;
  if (issue) {
    const [, owner = "", name = "", number = ""] = issue;
    return {
      kind: "issue",
      repository: { owner, name },
      number: Number(number),
    };
  }
  return { kind: "external", url: href };
}
