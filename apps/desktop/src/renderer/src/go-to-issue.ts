import type {
  IssueLookup,
  Problem,
  RecentIssue,
  RepositoryAddress,
  TrackedRepository,
} from "@verdandi/core/contract";
import {
  qualifiedReference,
  sameRepository,
} from "@verdandi/core/repository-address";
import type { IssueDestination } from "./issue-navigation";
import { linkTarget } from "./link-target";
import type { SidebarScope as Scope } from "./scope";

/**
 * An issue the Go to Issue field names: by its repository and number, or
 * by its number alone, in the repository of the tab.
 */
export interface IssueLocator {
  repository: RepositoryAddress | undefined;
  number: number;
}

/** The largest number GitHub asks for an issue by: a 32-bit `Int`. */
const largestNumber = 2 ** 31 - 1;

/**
 * The issue typed in the Go to Issue field: `#12` or `12`, `owner/name#12`,
 * `owner/name 12`, or a link to an issue on GitHub; none for anything else.
 */
export function issueLocator(text: string): IssueLocator | undefined {
  const trimmed = text.trim();
  const link = linkTarget(trimmed);
  if (link.kind === "issue") return numbered(link.repository, link.number);
  const qualified = /^([\w.-]+)\/([\w.-]+)(?:\s*#|\s+)(\d+)$/.exec(trimmed);
  if (qualified) {
    const [, owner = "", name = "", number = ""] = qualified;
    return numbered({ owner, name }, Number(number));
  }
  const bare = /^#?(\d+)$/.exec(trimmed);
  return bare ? numbered(undefined, Number(bare[1])) : undefined;
}

function numbered(
  repository: RepositoryAddress | undefined,
  number: number,
): IssueLocator | undefined {
  return number >= 1 && number <= largestNumber
    ? { repository, number }
    : undefined;
}

/** Somewhere ↩ in the palette goes. */
export type GoToDestination =
  /** An issue to ask GitHub about first. */
  | { kind: "look-up"; repository: RepositoryAddress; number: number }
  /** A recent issue, which opens without asking GitHub. */
  | { kind: "recent"; issue: RecentIssue };

/**
 * What the palette offers for what is typed: the issue typed, as the recent
 * issue it is if it is one, then the recent issues whose `owner/name#12` or
 * title has what is typed in it, each once. When it offers nothing for what
 * is typed, it says what it takes.
 */
export function goToChoices(
  text: string,
  {
    from,
    recents,
  }: {
    /** The repository a bare `#12` names, if any. */
    from: RepositoryAddress | undefined;
    recents: readonly RecentIssue[];
  },
): { destinations: GoToDestination[]; hint: string | undefined } {
  const locator = issueLocator(text);
  const repository = locator?.repository ?? from;
  const typedRecent =
    locator &&
    repository &&
    recents.find(
      (recent) =>
        recent.number === locator.number &&
        sameRepository(recent.repository, repository),
    );
  const typed: GoToDestination | undefined = typedRecent
    ? { kind: "recent", issue: typedRecent }
    : locator && repository
      ? { kind: "look-up", repository, number: locator.number }
      : undefined;
  const query = text.trim().toLowerCase();
  const matching = recents.filter(
    (recent) =>
      recent !== typedRecent &&
      (qualifiedReference(recent.repository, recent.number)
        .toLowerCase()
        .includes(query) ||
        recent.title.toLowerCase().includes(query)),
  );
  const destinations = [
    ...(typed ? [typed] : []),
    ...matching.map((issue) => ({ kind: "recent" as const, issue })),
  ];
  return {
    destinations,
    hint:
      query === "" || destinations.length > 0
        ? undefined
        : locator
          ? `#${String(locator.number)} names an issue only in a repository's tab: type owner/name#${String(locator.number)}.`
          : from
            ? "Type #12, owner/name#12 or a link to an issue on GitHub."
            : "Type owner/name#12 or a link to an issue on GitHub.",
  };
}

/**
 * Where an issue opened lives, as far as it is known: by its link, or by
 * its reference, `#12` naming the repository of the list it was opened
 * from.
 */
export function issueLocatorOf(
  issue: IssueDestination,
  entry: Scope | undefined,
): IssueLocator | undefined {
  const located =
    (issue.url === undefined ? undefined : issueLocator(issue.url)) ??
    issueLocator(issue.reference);
  if (!located || located.repository || entry?.kind !== "repository")
    return located;
  return { repository: entry.repository, number: located.number };
}

/**
 * The entry an issue chosen in a new tab opens over: its repository's, if
 * it is tracked, and All otherwise.
 */
export function tabEntryOf(
  repository: RepositoryAddress,
  tracked: readonly TrackedRepository[],
): Scope {
  const own = tracked.find((one) => sameRepository(one, repository));
  return own ? { kind: "repository", repository: own } : { kind: "all" };
}

/**
 * A recent issue as the list it opens over names it: `#12` in its own
 * repository's, `owner/name#12` elsewhere.
 */
export function openedIssue(
  issue: RecentIssue,
  entry: Scope | undefined,
): IssueDestination {
  const own =
    entry?.kind === "repository" &&
    sameRepository(entry.repository, issue.repository);
  const qualified = qualifiedReference(issue.repository, issue.number);
  return {
    id: issue.id,
    reference: own ? `#${String(issue.number)}` : qualified,
    title: issue.title,
    url: `https://github.com/${qualified.replace("#", "/issues/")}`,
  };
}

/**
 * An issue opened, as a recent issue, if where it lives is known: by its
 * link, or by its reference in the list it was opened from.
 */
export function recentIssueOf(
  issue: IssueDestination,
  entry: Scope | undefined,
): RecentIssue | undefined {
  const located = issueLocatorOf(issue, entry);
  if (!located?.repository) return undefined;
  return {
    id: issue.id,
    repository: located.repository,
    number: located.number,
    title: issue.title,
  };
}

/**
 * What the palette says under its field: a lookup under way, or why it
 * failed.
 */
export type GoToIssueStatus =
  | { kind: "idle" }
  | { kind: "looking-up"; reference: string }
  | { kind: "failed"; problem: Problem };

/**
 * What GitHub's answer for the issue typed does: an issue it found opens, a
 * pull request opens on GitHub, and otherwise the palette says why. A
 * lookup that was dropped, as when GitHub is read as another account, says
 * nothing, so that Enter asks again.
 */
export function afterLookUp(
  found: IssueLookup,
):
  | { kind: "open"; issue: IssueDestination }
  | { kind: "pull-request"; url: string }
  | GoToIssueStatus {
  switch (found.status) {
    case "found":
      return { kind: "open", issue: found.issue };
    case "pull-request":
      return { kind: "pull-request", url: found.url };
    case "failed":
      return found.problem.kind === "interrupted"
        ? { kind: "idle" }
        : { kind: "failed", problem: found.problem };
  }
}
