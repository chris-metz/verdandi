import type {
  IssueLookup,
  IssueNode,
  Problem,
  RepositoryAddress,
} from "@verdandi/core/contract";
import type { IssueDestination } from "./issue-navigation";
import { linkTarget } from "./link-target";
import { allNodes } from "./list-navigation";
import { repositoryLabel } from "./scope";

/** What the Go to issue dialog shows under its field. */
export type GoToIssueStatus =
  | { kind: "idle" }
  /** What was typed is not an issue number. */
  | { kind: "invalid" }
  /** GitHub is being asked for the issue. */
  | { kind: "looking-up"; number: number }
  /** The number is a pull request's, whose page Enter opens. */
  | { kind: "pull-request"; number: number; url: string }
  | { kind: "failed"; problem: Problem };

/** The largest number GitHub asks for an issue by: a 32-bit `Int`. */
const largestNumber = 2 ** 31 - 1;

/**
 * The issue number typed in the Go to issue dialog, with or without a
 * leading `#`; none for anything else.
 */
export function issueNumber(text: string): number | undefined {
  const digits = /^#?(\d+)$/.exec(text.trim())?.[1];
  const number = Number(digits);
  return number >= 1 && number <= largestNumber ? number : undefined;
}

/**
 * What ↵ does with a number before asking GitHub, if it needs to ask at all:
 * the issue already shown just closes the dialog, known by its page on
 * GitHub or as the list's issue with the number; an issue the repository's
 * list has, at any depth and collapsed away or not, opens at once; any
 * other is looked up. A repository's list names its own issues `#12`, and
 * those of other repositories `owner/name#12`.
 */
export function beforeLookUp(
  number: number,
  {
    repository,
    shown,
    trees,
  }: {
    repository: RepositoryAddress;
    /** The issue page on screen, if any. */
    shown: IssueDestination | undefined;
    /** The repository's list as last pushed. */
    trees: readonly IssueNode[];
  },
):
  | { kind: "shown" }
  | { kind: "open"; issue: IssueDestination }
  | {
      kind: "look-up";
    } {
  const page = shown?.url === undefined ? undefined : linkTarget(shown.url);
  if (
    page?.kind === "issue" &&
    page.number === number &&
    sameRepository(page.repository, repository)
  )
    return { kind: "shown" };
  const reference = `#${String(number)}`;
  const listed = allNodes(trees).find(
    (node) => node.issue.reference === reference,
  )?.issue;
  if (!listed) return { kind: "look-up" };
  if (listed.id === shown?.id) return { kind: "shown" };
  const { id, title, url } = listed;
  return { kind: "open", issue: { id, reference, title, url } };
}

/** Whether two addresses name the same repository, as GitHub ignores case. */
function sameRepository(a: RepositoryAddress, b: RepositoryAddress): boolean {
  return repositoryLabel(a).toLowerCase() === repositoryLabel(b).toLowerCase();
}

/**
 * What GitHub's answer for the number typed does: an issue it found opens,
 * and otherwise the dialog stays open with the number, saying why. A lookup
 * that was dropped, as when GitHub is read as another account, says
 * nothing, so that Enter asks again.
 */
export function afterLookUp(
  found: IssueLookup,
  number: number,
): { kind: "open"; issue: IssueDestination } | GoToIssueStatus {
  switch (found.status) {
    case "found":
      return { kind: "open", issue: found.issue };
    case "pull-request":
      return { kind: "pull-request", number, url: found.url };
    case "failed":
      return found.problem.kind === "interrupted"
        ? { kind: "idle" }
        : { kind: "failed", problem: found.problem };
  }
}
