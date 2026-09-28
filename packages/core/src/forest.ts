import type {
  IssueNode,
  IssueTree,
  ParentIssue,
  RepositoryAddress,
  Scope,
  UnreadIssue,
} from "./contract.ts";
import { identifyIssue, summarizeIssue } from "./issue-summary.ts";
import type { Issue, IssueReference } from "./github/port.ts";
import { nameWithOwner, sameRepository } from "./repository-address.ts";

/** A scope's list, arranged into its sub-issue forest. */
export interface Forest {
  trees: IssueTree[];
  /** How many closed issues of the scope's own repositories the forest shows. */
  closedShown: number;
  /**
   * Issues the forest names but has not read: sub-issues, and the ancestors
   * of the scope's open issues, in any repository.
   */
  missing: IssueReference[];
  /** Of the missing issues, those that would show only below collapsed ones. */
  belowCollapsed: ReadonlySet<string>;
}

export interface ForestOptions {
  scope: Scope;
  /** The open issues of the scope's repositories, as far as they have loaded. */
  openIssueIds: Iterable<string>;
  /** An issue read earlier. */
  lookup: (id: string) => Issue | undefined;
  /** Why an issue the forest names has not been read. */
  unread: (issue: IssueReference) => UnreadIssue;
  /** Whether a repository is tracked. */
  isTracked: (repository: RepositoryAddress) => boolean;
  /** Whether an issue's sub-issues show. */
  isExpanded: (id: string) => boolean;
}

/**
 * Arranges a scope's open issues into its sub-issue forest. The scope's own
 * repositories are a repository list's one repository, or in All every
 * tracked one. Their issues among the ancestors of the open issues are listed
 * too, open or closed, however many repositories lie in between. Below each
 * listed issue its sub-issues nest, from any repository. An issue already
 * nested below another listed issue does not also stand at the top, where a
 * chip names a parent issue the list does not show. A sub-issue that has not
 * been read shows as its parent issue names it, with why.
 */
export function buildForest({
  scope,
  openIssueIds,
  lookup,
  unread,
  isTracked,
  isExpanded,
}: ForestOptions): Forest {
  const all = scope.kind === "all";
  const isOwn = all
    ? isTracked
    : (address: RepositoryAddress) => sameRepository(address, scope.repository);
  const isExternal = (address: RepositoryAddress) =>
    !isTracked(address) && !isOwn(address);
  const missing = new Map<string, IssueReference>();
  const belowCollapsed = new Set<string>();

  // The ancestors of each open issue are read up to the top, through other
  // repositories too, to find the closed parent issues in the scope's own.
  const listed = new Map<string, Issue>();
  const climbed = new Set<string>();
  for (const id of openIssueIds) {
    let issue = lookup(id);
    while (issue && !climbed.has(issue.id)) {
      climbed.add(issue.id);
      if (isOwn(issue.repository)) listed.set(issue.id, issue);
      const parent = issue.parent;
      if (!parent) break;
      issue = lookup(parent.id);
      if (!issue) missing.set(parent.id, parent);
    }
  }

  const nested = new Set<string>();
  function markNested(issue: Issue) {
    for (const reference of issue.subIssues) {
      if (nested.has(reference.id)) continue;
      nested.add(reference.id);
      const subIssue = lookup(reference.id);
      if (subIssue) markNested(subIssue);
    }
  }
  for (const issue of listed.values()) markNested(issue);

  /**
   * `#12` where the repository goes without saying: beside a row's
   * repository chip in All, or in a repository's own list for its own
   * issues. Otherwise, as on a ↑ chip in All, `owner/name#12`.
   */
  function referenceTo(
    { repository: address, number }: IssueReference,
    place: "row" | "parent chip",
  ) {
    const repositoryShown = all ? place === "row" : isOwn(address);
    return repositoryShown
      ? `#${String(number)}`
      : `${nameWithOwner(address)}#${String(number)}`;
  }

  function nameParent(parent: IssueReference): ParentIssue {
    return {
      id: parent.id,
      reference: referenceTo(parent, "parent chip"),
      title: parent.title,
      external: isExternal(parent.repository),
      unread: lookup(parent.id) ? undefined : unread(parent),
    };
  }

  let closedShown = 0;
  const placed = new Set<string>();
  /** Places an issue with its sub-issues, below collapsed ones or not. */
  function place(
    issue: Issue,
    collapsedAbove: boolean,
  ): IssueNode & { unread?: undefined } {
    placed.add(issue.id);
    if (issue.state === "closed" && isOwn(issue.repository)) closedShown++;
    const expanded = isExpanded(issue.id);
    const hidden = collapsedAbove || !expanded;
    const subIssues: IssueNode[] = [];
    for (const reference of issue.subIssues) {
      if (placed.has(reference.id)) continue;
      const subIssue = lookup(reference.id);
      if (subIssue) {
        subIssues.push(place(subIssue, hidden));
        continue;
      }
      placed.add(reference.id);
      // A missing ancestor of an open issue shows as its parent issue.
      if (hidden && !missing.has(reference.id))
        belowCollapsed.add(reference.id);
      missing.set(reference.id, reference);
      subIssues.push({
        issue: identifyIssue(reference, {
          reference: referenceTo(reference, "row"),
          external: isExternal(reference.repository),
        }),
        subIssues: [],
        expanded: false,
        unread: unread(reference),
      });
    }
    return {
      issue: summarizeIssue(issue, {
        reference: referenceTo(issue, "row"),
        external: isExternal(issue.repository),
      }),
      subIssues,
      expanded,
    };
  }

  const trees = [...listed.values()]
    .filter((issue) => !nested.has(issue.id))
    .sort(topLevelOrder)
    .map((issue): IssueTree => ({
      ...place(issue, false),
      parent: issue.parent && nameParent(issue.parent),
    }));

  return {
    trees,
    closedShown,
    missing: [...missing.values()],
    belowCollapsed,
  };
}

/** Parent issues first, then the most recently updated. */
function topLevelOrder(a: Issue, b: Issue): number {
  const parentsFirst =
    Number(b.subIssues.length > 0) - Number(a.subIssues.length > 0);
  return (
    parentsFirst ||
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
    b.number - a.number
  );
}
