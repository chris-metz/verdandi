import type {
  IssueLookup,
  Problem,
  RepositoryAddress,
} from "@verdandi/core/contract";
import { openOnGitHubAttribute } from "./github-html";
import type { IssueDestination } from "./issue-navigation";
import { linkTarget, type LinkToIssue } from "./link-target";

/** What following a link in an issue's body may do. */
export interface LinkActions {
  /** Opens a linked issue in the app, from the link that was clicked. */
  openIssue: (link: LinkToIssue, anchor: HTMLAnchorElement) => void;
  /** Opens an `https://` address in the browser. */
  openExternal: (url: string) => void;
}

/**
 * Follows a click in a body or comment Verdandi shows, whose page on GitHub
 * is `url`, and says whether it handled it, so that the window does not
 * follow it too. A link to an issue opens it in the app; any other
 * `https://` link opens in the browser, one within the body scrolls to what
 * it names, and any other never opens. **Open on GitHub**, beside what
 * github.com renders itself, opens the body or comment there.
 */
export function followClick(
  target: EventTarget | null,
  body: HTMLElement,
  url: string,
  actions: LinkActions,
): boolean {
  const element = target instanceof Element ? target : null;
  if (element?.closest(`[${openOnGitHubAttribute}]`)) {
    actions.openExternal(url);
    return true;
  }
  const anchor = element?.closest("a");
  if (!anchor || !body.contains(anchor)) return false;
  const link = linkTarget(anchor.getAttribute("href") ?? "");
  switch (link.kind) {
    case "issue":
      actions.openIssue(link, anchor);
      break;
    case "external":
      actions.openExternal(link.url);
      break;
    case "anchor":
      scrollToAnchor(body, link.id);
      break;
    case "none":
      break;
  }
  return true;
}

/**
 * Scrolls to what a link within a body names, such as a footnote, in that
 * body: GitHub prefixes the IDs it keeps, but not always the links to them.
 */
function scrollToAnchor(body: HTMLElement, fragment: string) {
  let id = fragment;
  try {
    id = decodeURIComponent(fragment);
  } catch {
    // Not percent-encoded after all.
  }
  const target = [id, `user-content-${id}`]
    .map((candidate) => body.querySelector(`[id="${CSS.escape(candidate)}"]`))
    .find((found) => found !== null);
  target?.scrollIntoView({ block: "start" });
}

/**
 * Opens a linked issue, once the core has found it by its repository and
 * number: its page in the app, or a pull request, which Verdandi does not
 * show, in the browser. It answers why the issue could not be found, if it
 * could not, for the body to say where the link is; nothing when the lookup
 * was dropped, as when GitHub is read as another account.
 */
export async function openLinkToIssue(
  link: LinkToIssue,
  lookUp: (
    repository: RepositoryAddress,
    number: number,
  ) => Promise<IssueLookup>,
  actions: {
    open: (issue: IssueDestination) => void;
    openExternal: (url: string) => void;
  },
): Promise<Problem | undefined> {
  const found = await lookUp(link.repository, link.number);
  switch (found.status) {
    case "found":
      actions.open(found.issue);
      return undefined;
    case "pull-request":
      actions.openExternal(found.url);
      return undefined;
    case "failed":
      return found.problem.kind === "interrupted" ? undefined : found.problem;
  }
}
