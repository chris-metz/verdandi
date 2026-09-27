import type { IssueTree } from "@verdandi/core/contract";
import type { IssueDestination } from "./issue-navigation";
import {
  commandForKey,
  visibleRows,
  type ListCommand,
} from "./list-navigation";

export type PageTarget = IssueDestination & { url?: string };
export type IssuePageCommand =
  ListCommand | { kind: "back" } | { kind: "scroll"; direction: 1 | -1 };

/** Page-wide keys, independent of which relationship has the cursor. */
export function commandForIssuePageKey(
  event: Pick<KeyboardEvent, "key" | "shiftKey">,
  cursor: string,
  targets: readonly PageTarget[],
  trees: readonly IssueTree[],
): IssuePageCommand | undefined {
  const index = targets.findIndex(({ id }) => id === cursor);
  const target = targets[index];
  const select = (offset: number): IssuePageCommand | undefined => {
    const next = targets[index + offset];
    return next && { kind: "select", issueId: next.id };
  };
  switch (event.key) {
    case "Escape":
    case "Backspace":
    case "[":
      return { kind: "back" };
    case " ":
      return { kind: "scroll", direction: event.shiftKey ? -1 : 1 };
    case "k":
    case "ArrowUp":
      return select(-1);
    case "j":
    case "ArrowDown":
      return select(1);
    case "Enter":
      return target && { kind: "openIssue", issue: target };
    case "o":
      return target?.url
        ? { kind: "openOnGitHub", url: target.url }
        : undefined;
    default: {
      const key =
        event.key === "h"
          ? "ArrowLeft"
          : event.key === "l"
            ? "ArrowRight"
            : event.key;
      const rows = visibleRows(trees);
      const rowIndex = rows.findIndex(({ node }) => node.issue.id === cursor);
      if (rowIndex >= 0) return commandForKey(key, rows, rowIndex, trees);
      if (key === "ArrowLeft") return select(-1);
      if (key === "ArrowRight") return select(1);
      return undefined;
    }
  }
}

/** Applies this visit's expansion, leaving the cached page untouched. */
export function issuePageTrees(
  trees: readonly IssueTree[],
  expanded: readonly string[],
): IssueTree[] {
  const ids = new Set(expanded);
  function visit(node: IssueTree): IssueTree {
    return {
      ...node,
      expanded: ids.has(node.issue.id),
      subIssues: node.subIssues.map((sub) =>
        visit({ ...sub, parent: undefined }),
      ),
    };
  }
  return trees.map(visit);
}
