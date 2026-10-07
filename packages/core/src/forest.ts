import type {
  IssueNode,
  IssueState,
  IssueTree,
  Label,
  ParentIssue,
  RepositoryAddress,
  Scope,
  UnreadIssue,
} from "./contract.ts";
import { identifyIssue, summarizeIssue } from "./issue-summary.ts";
import type { Issue, IssueReference } from "./github/port.ts";
import { carriesEvery } from "./label-filter.ts";
import { qualifiedReference, sameRepository } from "./repository-address.ts";

/** A scope's list, arranged into its sub-issue forest. */
export interface Forest {
  trees: IssueTree[];
  /** How many closed issues of the scope's own repositories the forest shows. */
  closedShown: number;
  /**
   * Issues the forest names but has not read: sub-issues, and the ancestors
   * of the matches, in any repository.
   */
  missing: IssueReference[];
  /** Of the missing issues, those that would show only below collapsed ones. */
  belowCollapsed: ReadonlySet<string>;
}

export interface ForestOptions {
  scope: Scope;
  /** Which of the scope's issues match. */
  state: IssueState;
  /**
   * The issues of the scope's repositories in its state, as far as they have
   * loaded: its matches, unless a label filter narrows them.
   */
  scopeIds: Iterable<string>;
  /** The labels a match carries every one of; none without a label filter. */
  labelFilter: readonly Label[];
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
 * Arranges a scope's matches, its open or its closed issues that carry every
 * label of its label filter, into its sub-issue forest. The scope's own
 * repositories are a repository list's one repository, or in All every
 * tracked one. Their issues among the ancestors of the matches are listed
 * too, open or closed, however many repositories lie in between. Below each
 * listed issue its sub-issues nest, from any repository. An issue already
 * nested below another listed issue does not also stand at the top, where a
 * chip names a parent issue the list does not show. A sub-issue that has not
 * been read shows as its parent issue names it, with why.
 *
 * The newest stand first: each top-level issue by the newest match within
 * its tree, collapsed or not, or by itself if there is none. An open match
 * is as new as when it was opened, a closed one as when it was closed. Ties
 * go to the higher number. Sub-issues keep GitHub's order.
 *
 * With a label filter, every issue is marked a match or a context issue,
 * with how many matches lie below it.
 */
export function buildForest({
  scope,
  state,
  scopeIds,
  labelFilter,
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
  const filtered = labelFilter.length > 0;
  const matches = new Set(
    filtered
      ? [...scopeIds].filter((id) => {
          const issue = lookup(id);
          return issue !== undefined && carriesEvery(issue.labels, labelFilter);
        })
      : scopeIds,
  );

  // The ancestors of each match are read up to the top, through other
  // repositories too, to find the parent issues in the scope's own.
  const listed = new Map<string, Issue>();
  const climbed = new Set<string>();
  for (const id of matches) {
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
      : qualifiedReference(address, number);
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
    let matchesInside = 0;
    for (const reference of issue.subIssues) {
      if (placed.has(reference.id)) continue;
      const subIssue = lookup(reference.id);
      if (subIssue) {
        const node = place(subIssue, hidden);
        subIssues.push(node);
        matchesInside +=
          Number(node.mark?.match) + (node.mark?.matchesInside ?? 0);
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
        ...(filtered
          ? { mark: { match: false, mayMatch: false, matchesInside: 0 } }
          : {}),
      });
    }
    return {
      issue: summarizeIssue(issue, {
        reference: referenceTo(issue, "row"),
        external: isExternal(issue.repository),
      }),
      subIssues,
      expanded,
      ...(filtered
        ? {
            mark: {
              match: matches.has(issue.id),
              mayMatch: false,
              matchesInside,
            },
          }
        : {}),
    };
  }

  /** How new an issue is: when it was opened, or closed in a closed list. */
  function timeOf(issue: Issue): number {
    return Date.parse(
      state === "closed"
        ? (issue.closedAt ?? issue.createdAt)
        : issue.createdAt,
    );
  }

  const newest = new Map<string, number>();
  /** How new the newest match within an issue's tree is. */
  function newestMatch(issue: Issue): number {
    const known = newest.get(issue.id);
    if (known !== undefined) return known;
    newest.set(issue.id, -Infinity);
    let time = matches.has(issue.id) ? timeOf(issue) : -Infinity;
    for (const reference of issue.subIssues) {
      const subIssue = lookup(reference.id);
      if (subIssue) time = Math.max(time, newestMatch(subIssue));
    }
    newest.set(issue.id, time);
    return time;
  }

  const trees = [...listed.values()]
    .filter((issue) => !nested.has(issue.id))
    .map((issue) => {
      const time = newestMatch(issue);
      return { issue, time: time === -Infinity ? timeOf(issue) : time };
    })
    .sort((a, b) => b.time - a.time || b.issue.number - a.issue.number)
    .map(({ issue }): IssueTree => ({
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
