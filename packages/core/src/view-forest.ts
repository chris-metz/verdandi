import type {
  IssueNode,
  Label,
  RepositoryAddress,
  UnreadIssue,
  ViewTree,
} from "./contract.ts";
import type { Issue, IssueReference, SearchMatch } from "./github/port.ts";
import { identifyIssue, summarizeIssue } from "./issue-summary.ts";
import { carriesEvery } from "./label-filter.ts";

/** A view's matches, arranged into their trees. */
export interface ViewForest {
  trees: ViewTree[];
  /** How many matches the trees show, each once. */
  matchesShown: number;
  /** How many issues the search returned, each once. */
  inScope: number;
  /**
   * Issues the forest needs but has not read: the matches, whose parent
   * issues and sub-issues only reading them tells, their ancestors, the other
   * issues the search returned that it shows, and the sub-issues it shows or
   * would show once one collapsed issue expands. Those below a context issue
   * further down are read once they come near.
   */
  missing: IssueReference[];
  /** Of the missing issues, those that would show only below collapsed ones. */
  belowCollapsed: ReadonlySet<string>;
  /**
   * Ancestors read before the issue below them became their sub-issue, as
   * that issue names them its parent, to read again.
   */
  outdatedAncestors: string[];
  /** The issues the forest shows as read, not collapsed away. */
  shownIssues: string[];
}

export interface ViewForestOptions {
  /** The issues the search returned, in its order. */
  returned: readonly SearchMatch[];
  /**
   * The labels a match carries every one of, besides being returned; none
   * without a label filter.
   */
  labelFilter: readonly Label[];
  /**
   * Whether the search returned all it matches, so that the context issues
   * it did not return are known not to match.
   */
  complete: boolean;
  /** An issue read earlier, with its relationships. */
  lookup: (id: string) => Issue | undefined;
  /**
   * Whether an issue was read since the search ran, so that its parent
   * issue, or the lack of one, is as new as the search's pointer to it.
   */
  readSinceSearch: (id: string) => boolean;
  /** Why an issue the forest names, a match included, has not been read. */
  unread: (issue: IssueReference) => UnreadIssue;
  /** Whether a repository is tracked. */
  isTracked: (repository: RepositoryAddress) => boolean;
  /**
   * Whether an issue's sub-issues show, given whether it is on a path to a
   * match.
   */
  isExpanded: (id: string, onPath: boolean) => boolean;
}

/** GitHub's word for an issue it would not show this account. */
const notVisible: UnreadIssue = {
  status: "failed",
  problem: { kind: "unavailable", access: undefined },
};

/**
 * Arranges a view's matches into trees: each match under its whole
 * ancestry, as far as it has been read, up to its top-level issue, and below
 * each issue its sub-issues in GitHub's order, matches or context issues.
 * Each issue appears once. An issue the search returned whose relationships
 * have not been read shows as the search answered it, a match as a tree of
 * its own unless an issue shown names it as a sub-issue. The trees are in
 * the order of the search's rank of the first match anywhere inside each.
 *
 * The matches are the issues the search returned that carry every label of
 * the label filter, as last read. An issue that lacks one is known not to
 * match; one the search did not return may match only while the search's
 * results are not complete.
 */
export function buildViewForest({
  returned,
  labelFilter,
  complete,
  lookup,
  readSinceSearch,
  unread,
  isTracked,
  isExpanded,
}: ViewForestOptions): ViewForest {
  /** Whether an issue carries every label of the label filter. */
  const hasEveryLabel = (issue: Pick<Issue, "labels">) =>
    carriesEvery(issue.labels, labelFilter);
  const returnedById = new Map<string, SearchMatch>();
  const ranks = new Map<string, number>();
  const matchById = new Map<string, SearchMatch>();
  for (const [rank, answer] of returned.entries()) {
    if (returnedById.has(answer.id)) continue;
    returnedById.set(answer.id, answer);
    if (!hasEveryLabel(lookup(answer.id) ?? answer)) continue;
    ranks.set(answer.id, rank);
    matchById.set(answer.id, answer);
  }
  const missing = new Map<string, IssueReference>();
  const outdatedAncestors = new Set<string>();

  // Each match climbs to the top-most ancestor that has been read, which
  // names why the parent issue above it does not show, if one does not.
  const tops = new Map<string, UnreadIssue | undefined>();
  for (const match of matchById.values()) {
    let issue = lookup(match.id);
    if (!issue) {
      missing.set(match.id, match);
      if (!tops.has(match.id)) {
        tops.set(match.id, match.hasParent ? unread(match) : undefined);
      }
      continue;
    }
    let missingParent: UnreadIssue | undefined;
    const climbed = new Set<string>();
    for (;;) {
      climbed.add(issue.id);
      const parent = issue.parent;
      if (!parent) {
        // The search names a parent issue that reading the match since left
        // out: GitHub does not show it to this account. An older read
        // tells nothing yet.
        if (issue.id === match.id && match.hasParent) {
          missingParent = readSinceSearch(match.id)
            ? notVisible
            : { status: "loading" };
        }
        break;
      }
      const above = lookup(parent.id);
      if (!above) {
        missing.set(parent.id, parent);
        missingParent = unread(parent);
        break;
      }
      if (climbed.has(above.id)) break;
      const below = issue.id;
      if (!above.subIssues.some(({ id }) => id === below)) {
        outdatedAncestors.add(above.id);
      }
      issue = above;
    }
    if (!tops.has(issue.id)) tops.set(issue.id, missingParent);
  }

  // An issue that shows below another is no tree of its own.
  const nested = new Set<string>();
  function markNested(issue: Issue) {
    for (const reference of issue.subIssues) {
      if (nested.has(reference.id)) continue;
      nested.add(reference.id);
      const subIssue = lookup(reference.id);
      if (subIssue) markNested(subIssue);
    }
  }
  for (const id of tops.keys()) {
    const issue = lookup(id);
    if (issue) markNested(issue);
  }

  const presentation = (repository: RepositoryAddress, number: number) => ({
    // Every row names its repository with a chip, as in All.
    reference: `#${String(number)}`,
    external: !isTracked(repository),
  });

  const placed = new Set<string>();
  /**
   * Places an issue with its sub-issues, and says the rank of the first
   * match in it.
   */
  function place(reference: IssueReference): {
    node: IssueNode;
    firstRank: number;
  } {
    const { id } = reference;
    placed.add(id);
    const answer = returnedById.get(id);
    const match = matchById.has(id);
    const rank = ranks.get(id) ?? Infinity;
    const issue = lookup(id);
    if (!issue && !answer) {
      missing.set(id, reference);
      return {
        node: {
          issue: identifyIssue(
            reference,
            presentation(reference.repository, reference.number),
          ),
          subIssues: [],
          expanded: false,
          unread: unread(reference),
          mark: { match: false, mayMatch: !complete, matchesInside: 0 },
        },
        firstRank: rank,
      };
    }
    const subIssues: IssueNode[] = [];
    let firstRank = rank;
    let matchesInside = 0;
    for (const subReference of issue?.subIssues ?? []) {
      if (placed.has(subReference.id)) continue;
      const sub = place(subReference);
      subIssues.push(sub.node);
      firstRank = Math.min(firstRank, sub.firstRank);
      matchesInside +=
        Number(sub.node.mark?.match) + (sub.node.mark?.matchesInside ?? 0);
    }
    // An issue returned but not read yet shows as the search answered it,
    // and is read for its relationships, a match or not.
    if (!issue) missing.set(id, reference);
    const shown: Issue = issue ?? {
      ...(answer as SearchMatch),
      parent: undefined,
      subIssues: [],
      incomplete: undefined,
    };
    return {
      node: {
        issue: summarizeIssue(
          shown,
          presentation(shown.repository, shown.number),
        ),
        subIssues,
        expanded: isExpanded(id, matchesInside > 0),
        mark: {
          match,
          mayMatch: !answer && !complete && hasEveryLabel(shown),
          matchesInside,
        },
      },
      firstRank,
    };
  }

  const ranked: { tree: ViewTree; firstRank: number }[] = [];
  function plant(reference: IssueReference, missingParent?: UnreadIssue) {
    const { node, firstRank } = place(reference);
    ranked.push({
      tree: { ...node, parent: undefined, missingParent },
      firstRank,
    });
  }
  for (const [id, missingParent] of tops) {
    if (nested.has(id) || placed.has(id)) continue;
    const issue = lookup(id) ?? matchById.get(id);
    if (issue) plant(issue, missingParent);
  }
  // A match its ancestors do not name as a sub-issue, as when GitHub
  // answered them at different times, still shows.
  for (const match of matchById.values()) {
    if (!placed.has(match.id)) plant(lookup(match.id) ?? match);
  }
  const trees = ranked
    .sort((a, b) => a.firstRank - b.firstRank)
    .map(({ tree }) => tree);

  // What shows is read first, then what one collapsed issue hides; what
  // lies further below waits until it comes nearer.
  const belowCollapsed = new Set<string>();
  const shownIssues: string[] = [];
  function survey(node: IssueNode, collapsedAbove: number) {
    if (node.unread) {
      if (collapsedAbove === 1) belowCollapsed.add(node.issue.id);
      if (collapsedAbove > 1) missing.delete(node.issue.id);
      return;
    }
    if (collapsedAbove === 0) shownIssues.push(node.issue.id);
    const below = collapsedAbove + Number(collapsedAbove > 0 || !node.expanded);
    for (const sub of node.subIssues) survey(sub, below);
  }
  for (const tree of trees) survey(tree, 0);

  return {
    trees,
    matchesShown: matchById.size,
    inScope: returnedById.size,
    missing: [...missing.values()],
    belowCollapsed,
    outdatedAncestors: [...outdatedAncestors],
    shownIssues,
  };
}
