import type {
  IssueNode,
  IssueTree,
  ParentIssue,
} from "@verdandi/core/contract";

import type { IssueDestination } from "./issue-navigation";

/** A row of a list as it shows, top to bottom. */
export interface ListRow {
  node: IssueNode;
  /** How deeply it is nested: 0 at the top level. */
  depth: number;
  /** The issue it nests below in the list, if any. */
  parentId: string | undefined;
  /** The parent issue a top-level row names with a ↑ chip, if any. */
  parent: ParentIssue | undefined;
}

/** What a key asks for. */
export type ListCommand =
  | { kind: "openIssue"; issue: IssueDestination }
  | { kind: "select"; issueId: string }
  | { kind: "setExpanded"; issueId: string; expanded: boolean }
  | { kind: "setAllExpanded"; expanded: boolean }
  | { kind: "openOnGitHub"; url: string };

/** The rows a forest shows: every tree, with the sub-issues of expanded ones. */
export function visibleRows(trees: readonly IssueTree[]): ListRow[] {
  const rows: ListRow[] = [];
  function add(node: IssueNode, depth: number, parentId: string | undefined) {
    rows.push({ node, depth, parentId, parent: undefined });
    if (!node.expanded) return;
    for (const subIssue of node.subIssues) {
      add(subIssue, depth + 1, node.issue.id);
    }
  }
  for (const tree of trees) {
    const index = rows.length;
    add(tree, 0, undefined);
    const top = rows[index];
    if (top) top.parent = tree.parent;
  }
  return rows;
}

/**
 * Which row shows the selection: the selected issue's, else that of its
 * nearest parent issue that shows, else the first. -1 if there are no rows.
 */
export function selectionIndex(
  trees: readonly IssueTree[],
  rows: readonly ListRow[],
  selectedId: string | undefined,
): number {
  if (rows.length === 0) return -1;
  const parents = parentIds(trees);
  let id = selectedId;
  while (id !== undefined) {
    const shown = id;
    const index = rows.findIndex((row) => row.node.issue.id === shown);
    if (index >= 0) return index;
    id = parents.get(shown);
  }
  return 0;
}

/**
 * Which issue the selection is on once a list has changed under it, e.g.
 * after it was read again. It stays on the same issue while the list has it,
 * even collapsed away, or has not loaded it yet. If the issue disappeared, it
 * goes to the row the selection showed on, if that remains, else to the
 * nearest row that still shows, below it first, else to none.
 */
export function followSelection(
  previous: readonly IssueTree[],
  trees: readonly IssueTree[],
  selectedId: string | undefined,
): string | undefined {
  const has = (forest: readonly IssueTree[], id: string) =>
    allNodes(forest).some((node) => node.issue.id === id);
  if (
    selectedId === undefined ||
    has(trees, selectedId) ||
    !has(previous, selectedId)
  ) {
    return selectedId;
  }
  const before = visibleRows(previous);
  const shownOn =
    before[selectionIndex(previous, before, selectedId)]?.node.issue.id;
  if (shownOn === undefined) return undefined;
  if (shownOn !== selectedId && has(trees, shownOn)) return shownOn;
  return nearestRemaining(
    before.map((row) => row.node.issue.id),
    visibleRows(trees).map((row) => row.node.issue.id),
    shownOn,
  );
}

/**
 * The nearest neighbour of an item that is gone, among those that were
 * around it and remain: the one after it first, then the one before it, then
 * further away.
 */
export function nearestRemaining(
  before: readonly string[],
  after: readonly string[],
  gone: string,
): string | undefined {
  const index = before.indexOf(gone);
  if (index < 0) return undefined;
  const remaining = new Set(after);
  for (let distance = 1; distance < before.length; distance++) {
    for (const neighbour of [
      before[index + distance],
      before[index - distance],
    ]) {
      if (neighbour !== undefined && remaining.has(neighbour)) return neighbour;
    }
  }
  return undefined;
}

/**
 * What a key does in a list, with the selection on the row at `index`:
 * `j`/`k`/↑/↓ move it, ←/→ collapse and expand (← on a sub-issue jumps to its
 * parent issue, → on an expanded issue steps into its sub-issues), `e`
 * expands or collapses every tree, and `o` opens the issue on GitHub.
 */
export function commandForKey(
  key: string,
  rows: readonly ListRow[],
  index: number,
  trees: readonly IssueTree[],
): ListCommand | undefined {
  const row = rows[index];
  if (!row) return undefined;
  const { node } = row;
  const select = (target: ListRow | undefined): ListCommand | undefined =>
    target && { kind: "select", issueId: target.node.issue.id };
  switch (key) {
    case "j":
    case "ArrowDown":
      return select(rows[index + 1]);
    case "k":
    case "ArrowUp":
      return select(rows[index - 1]);
    case "ArrowRight":
      if (node.subIssues.length === 0) return undefined;
      if (!node.expanded) {
        return { kind: "setExpanded", issueId: node.issue.id, expanded: true };
      }
      return select(rows[index + 1]);
    case "ArrowLeft":
      if (node.expanded && node.subIssues.length > 0) {
        return { kind: "setExpanded", issueId: node.issue.id, expanded: false };
      }
      return select(rows.find((other) => other.node.issue.id === row.parentId));
    case "e": {
      const nodes = allNodes(trees).filter(
        (other) => other.subIssues.length > 0,
      );
      if (nodes.length === 0) return undefined;
      return {
        kind: "setAllExpanded",
        expanded: nodes.some((other) => !other.expanded),
      };
    }
    case "Enter": {
      const { id, reference, title } = node.issue;
      return { kind: "openIssue", issue: { id, reference, title } };
    }
    case "o":
      return { kind: "openOnGitHub", url: node.issue.url };
    default:
      return undefined;
  }
}

/** Every issue of a forest, shown or collapsed away. */
function allNodes(trees: readonly IssueNode[]): IssueNode[] {
  return trees.flatMap((node) => [node, ...allNodes(node.subIssues)]);
}

/** The parent issue of every sub-issue in a forest, by ID. */
function parentIds(trees: readonly IssueNode[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const node of allNodes(trees)) {
    for (const subIssue of node.subIssues) {
      parents.set(subIssue.issue.id, node.issue.id);
    }
  }
  return parents;
}
