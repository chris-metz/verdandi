import type {
  IssueNode,
  IssueSummary,
  IssueTree,
  ParentIssue,
  RepositoryAddress,
} from "./contract.ts";
import type { Issue, IssueReference } from "./github/port.ts";
import { sameRepository } from "./repository-address.ts";

/** A tracked repository's list, arranged into its sub-issue forest. */
export interface RepositoryForest {
  trees: IssueTree[];
  /** How many of the repository's closed issues the forest shows. */
  closedShown: number;
  /**
   * Issues the forest names but has not read: sub-issues, and the ancestors
   * of the repository's open issues, in any repository.
   */
  missing: IssueReference[];
}

export interface RepositoryForestOptions {
  repository: RepositoryAddress;
  /** The repository's open issues, as far as they have loaded. */
  openIssueIds: Iterable<string>;
  /** An issue read earlier. */
  lookup: (id: string) => Issue | undefined;
  /** Whether a repository is tracked. */
  isTracked: (repository: RepositoryAddress) => boolean;
  /** Whether an issue's sub-issues show. */
  isExpanded: (id: string) => boolean;
}

/**
 * Arranges a repository's open issues into its sub-issue forest. The issues
 * of the same repository among their ancestors are listed too, open or
 * closed, however many repositories lie in between. Below each listed issue
 * its sub-issues nest, from any repository. An issue already nested below
 * another listed issue does not also stand at the top, where a chip names a
 * parent issue the list does not show.
 */
export function buildRepositoryForest({
  repository,
  openIssueIds,
  lookup,
  isTracked,
  isExpanded,
}: RepositoryForestOptions): RepositoryForest {
  const isHome = (address: RepositoryAddress) =>
    sameRepository(address, repository);
  const missing = new Map<string, IssueReference>();

  // The ancestors of each open issue are read up to the top, through other
  // repositories too, to find the closed parent issues in this one.
  const listed = new Map<string, Issue>();
  const climbed = new Set<string>();
  for (const id of openIssueIds) {
    let issue = lookup(id);
    while (issue && !climbed.has(issue.id)) {
      climbed.add(issue.id);
      if (isHome(issue.repository)) listed.set(issue.id, issue);
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

  function summarize(issue: Issue): IssueSummary {
    const { blockedBy, totalBlockedBy, blocking, totalBlocking } =
      issue.issueDependenciesSummary;
    return {
      id: issue.id,
      reference: referenceTo(issue),
      title: issue.title,
      state: issue.state,
      url: issue.url,
      labels: issue.labels,
      external: !isTracked(issue.repository) && !isHome(issue.repository),
      subIssueProgress: {
        closed: issue.subIssuesSummary.completed,
        total: issue.subIssuesSummary.total,
      },
      blockedBy: { open: blockedBy, total: totalBlockedBy },
      blocking: { open: blocking, total: totalBlocking },
    };
  }

  function referenceTo({ repository: address, number }: IssueReference) {
    return isHome(address)
      ? `#${String(number)}`
      : `${address.owner}/${address.name}#${String(number)}`;
  }

  function nameParent(parent: IssueReference): ParentIssue {
    return {
      id: parent.id,
      reference: referenceTo(parent),
      title: parent.title,
      external: !isTracked(parent.repository) && !isHome(parent.repository),
    };
  }

  let closedShown = 0;
  const placed = new Set<string>();
  function place(issue: Issue): IssueNode {
    placed.add(issue.id);
    if (issue.state === "closed" && isHome(issue.repository)) closedShown++;
    const subIssues: IssueNode[] = [];
    for (const reference of issue.subIssues) {
      if (placed.has(reference.id)) continue;
      const subIssue = lookup(reference.id);
      if (subIssue) subIssues.push(place(subIssue));
      else missing.set(reference.id, reference);
    }
    return {
      issue: summarize(issue),
      subIssues,
      expanded: isExpanded(issue.id),
    };
  }

  const trees = [...listed.values()]
    .filter((issue) => !nested.has(issue.id))
    .sort(topLevelOrder)
    .map((issue): IssueTree => ({
      ...place(issue),
      parent: issue.parent && nameParent(issue.parent),
    }));

  return { trees, closedShown, missing: [...missing.values()] };
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
