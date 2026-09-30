import type { IssueNode, IssueTree } from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import {
  commandForKey,
  followSelection,
  selectionIndex,
  visibleRows,
  type ListCommand,
} from "./list-navigation";

/** An issue of `acme/api` and its sub-issues. */
function issue(
  number: number,
  subIssues: IssueNode[] = [],
  expanded = true,
): IssueNode {
  return {
    issue: {
      id: `I_${String(number)}`,
      repository: { owner: "acme", name: "api" },
      reference: `#${String(number)}`,
      title: `Issue ${String(number)}`,
      state: "open",
      url: `https://github.com/acme/api/issues/${String(number)}`,
      author: undefined,
      createdAt: "2026-09-01T12:00:00Z",
      labels: [],
      external: false,
      subIssueProgress: { closed: 0, total: subIssues.length },
      blockedBy: { open: 0, total: 0 },
      blocking: { open: 0, total: 0 },
      incomplete: undefined,
    },
    subIssues,
    expanded,
  };
}

function tree(node: IssueNode): IssueTree {
  return { ...node, parent: undefined };
}

/**
 * #1 with sub-issues #2 (itself with #3) and #4, then #5 alone, then #6 with
 * #7, collapsed.
 */
const forest: IssueTree[] = [
  tree(issue(1, [issue(2, [issue(3)]), issue(4)])),
  tree(issue(5)),
  tree(issue(6, [issue(7)], false)),
];

/** What a key does with the selection on an issue, by number. */
function press(
  key: string,
  selected: number | undefined,
  trees: IssueTree[] = forest,
): ListCommand | undefined {
  const rows = visibleRows(trees);
  const index = selectionIndex(
    trees,
    rows,
    selected === undefined ? undefined : `I_${String(selected)}`,
  );
  return commandForKey(key, rows, index, trees);
}

function select(number: number): ListCommand {
  return { kind: "select", issueId: `I_${String(number)}` };
}

describe("visible rows", () => {
  it("nests a view's tree below its missing parent issue once it could not be loaded", () => {
    const failed = {
      status: "failed",
      problem: { kind: "interrupted" },
    } as const;
    const trees = [
      { ...tree(issue(1, [issue(2)])), missingParent: failed },
      { ...tree(issue(3)), missingParent: { status: "loading" } as const },
    ];
    expect(
      visibleRows(trees).map(({ node, depth, missingParent }) => ({
        issue: node.issue.reference,
        depth,
        missingParent: missingParent?.status,
      })),
    ).toEqual([
      { issue: "#1", depth: 1, missingParent: "failed" },
      { issue: "#2", depth: 2, missingParent: undefined },
      { issue: "#3", depth: 0, missingParent: "loading" },
    ]);
  });

  it("shows expanded sub-issues nested below their parent issue", () => {
    expect(
      visibleRows(forest).map(({ node, depth, parentId }) => ({
        issue: node.issue.reference,
        depth,
        parentId,
      })),
    ).toEqual([
      { issue: "#1", depth: 0, parentId: undefined },
      { issue: "#2", depth: 1, parentId: "I_1" },
      { issue: "#3", depth: 2, parentId: "I_2" },
      { issue: "#4", depth: 1, parentId: "I_1" },
      { issue: "#5", depth: 0, parentId: undefined },
      { issue: "#6", depth: 0, parentId: undefined },
    ]);
  });
});

describe("selection", () => {
  it("stays on the selected issue", () => {
    const rows = visibleRows(forest);
    expect(rows[selectionIndex(forest, rows, "I_3")]?.node.issue.id).toBe(
      "I_3",
    );
  });

  it("shows on the nearest shown parent issue when collapsed away", () => {
    const rows = visibleRows(forest);
    expect(rows[selectionIndex(forest, rows, "I_7")]?.node.issue.id).toBe(
      "I_6",
    );
  });

  it("starts on the first row", () => {
    const rows = visibleRows(forest);
    expect(selectionIndex(forest, rows, undefined)).toBe(0);
    expect(selectionIndex(forest, rows, "I_99")).toBe(0);
  });

  it("is nowhere in an empty list", () => {
    expect(selectionIndex([], [], "I_1")).toBe(-1);
  });
});

describe("selection as the list changes under it", () => {
  /** Where the selection goes when the list changes, by number. */
  function follow(
    before: IssueTree[],
    after: IssueTree[],
    selected: number,
  ): string | undefined {
    return followSelection(before, after, `I_${String(selected)}`);
  }

  it("stays on the same issue wherever it moves", () => {
    expect(
      follow(forest, [tree(issue(5)), tree(issue(1)), tree(issue(6))], 5),
    ).toBe("I_5");
  });

  it("stays on an issue collapsed away, which shows on its parent issue", () => {
    expect(
      follow(forest, [tree(issue(1, [issue(2, [issue(3)], false)]))], 3),
    ).toBe("I_3");
  });

  it("stays on an issue that has not loaded yet", () => {
    expect(follow([], forest, 9)).toBe("I_9");
    expect(follow(forest, forest, 9)).toBe("I_9");
  });

  it("moves to the issue below one that disappeared", () => {
    expect(
      follow(forest, [tree(issue(1, [issue(2), issue(4)])), tree(issue(5))], 3),
    ).toBe("I_4");
  });

  it("moves to the issue above one that disappeared at the end", () => {
    expect(follow(forest, [tree(issue(1)), tree(issue(5))], 6)).toBe("I_5");
  });

  it("passes over neighbours that disappeared as well", () => {
    expect(follow(forest, [tree(issue(1)), tree(issue(6))], 3)).toBe("I_1");
  });

  it("moves to the parent issue it showed on when it disappears collapsed away", () => {
    expect(follow(forest, [tree(issue(6)), tree(issue(5))], 7)).toBe("I_6");
  });

  it("is on no issue when none that showed is left", () => {
    expect(follow(forest, [tree(issue(9))], 3)).toBeUndefined();
  });
});

describe("keys", () => {
  it("move the selection down with j and ↓, stopping at the last row", () => {
    expect(press("j", 1)).toEqual(select(2));
    expect(press("ArrowDown", 4)).toEqual(select(5));
    expect(press("j", 6)).toBeUndefined();
  });

  it("move the selection up with k and ↑, stopping at the first row", () => {
    expect(press("k", 5)).toEqual(select(4));
    expect(press("ArrowUp", 2)).toEqual(select(1));
    expect(press("k", 1)).toBeUndefined();
  });

  it("move from where the selection shows", () => {
    // #7 is collapsed away, so the selection shows on #6.
    expect(press("k", 7)).toEqual(select(5));
  });

  it("expand a collapsed issue with →, then step into its sub-issues", () => {
    expect(press("ArrowRight", 6)).toEqual({
      kind: "setExpanded",
      issueId: "I_6",
      expanded: true,
    });
    expect(press("ArrowRight", 1)).toEqual(select(2));
    expect(press("ArrowRight", 5)).toBeUndefined();
  });

  it("collapse an expanded issue with ←", () => {
    expect(press("ArrowLeft", 2)).toEqual({
      kind: "setExpanded",
      issueId: "I_2",
      expanded: false,
    });
  });

  it("jump from a sub-issue to its parent issue with ←", () => {
    expect(press("ArrowLeft", 3)).toEqual(select(2));
    expect(press("ArrowLeft", 4)).toEqual(select(1));
    const collapsed = [tree(issue(1, [issue(2, [issue(3)], false)]))];
    expect(press("ArrowLeft", 2, collapsed)).toEqual(select(1));
  });

  it("do nothing with ← on a top-level issue without shown sub-issues", () => {
    expect(press("ArrowLeft", 5)).toBeUndefined();
    expect(press("ArrowLeft", 6)).toBeUndefined();
  });

  it("expand every tree with e while any issue is collapsed", () => {
    expect(press("e", 5)).toEqual({ kind: "setAllExpanded", expanded: true });
  });

  it("collapse every tree with e once all are expanded", () => {
    const expanded = [tree(issue(1, [issue(2, [issue(3)])])), tree(issue(5))];
    expect(press("e", 1, expanded)).toEqual({
      kind: "setAllExpanded",
      expanded: false,
    });
  });

  it("do nothing with e when no issue has sub-issues", () => {
    expect(press("e", 1, [tree(issue(1)), tree(issue(2))])).toBeUndefined();
  });

  it("open the selected issue on GitHub with o", () => {
    expect(press("o", 4)).toEqual({
      kind: "openOnGitHub",
      url: "https://github.com/acme/api/issues/4",
    });
  });

  it("do nothing in an empty list", () => {
    for (const key of ["j", "k", "ArrowLeft", "ArrowRight", "e", "o"]) {
      expect(press(key, undefined, [])).toBeUndefined();
    }
  });

  it("ignore other keys", () => {
    expect(press("x", 1)).toBeUndefined();
  });

  it("clear the label filter with Esc, also once nothing matches", () => {
    expect(press("Escape", 4)).toEqual({ kind: "clearLabelFilter" });
    expect(press("Escape", undefined, [])).toEqual({
      kind: "clearLabelFilter",
    });
  });
});

it("opens the selected issue in the app on Enter", () => {
  expect(press("Enter", 3)).toEqual({
    kind: "openIssue",
    issue: { id: "I_3", reference: "#3", title: "Issue 3" },
  });
});
