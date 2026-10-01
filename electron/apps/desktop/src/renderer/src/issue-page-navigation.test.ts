import { describe, expect, it } from "vitest";
import {
  commandForIssuePageKey,
  followCursor,
  type CursorPlace,
} from "./issue-page-navigation";

const current = {
  id: "issue",
  reference: "#2",
  title: "Issue",
  url: "https://github.com/acme/api/issues/2",
};
const ancestor = { id: "parent", reference: "acme/api#1", title: "Parent" };
const targets = [ancestor, current];

it("steps back on every back key and scrolls in both directions with Space", () => {
  for (const key of ["Escape", "Backspace", "["]) {
    expect(
      commandForIssuePageKey({ key, shiftKey: false }, current.id, targets, []),
    ).toEqual({ kind: "back" });
  }
  expect(
    commandForIssuePageKey(
      { key: " ", shiftKey: false },
      current.id,
      targets,
      [],
    ),
  ).toEqual({ kind: "scroll", direction: 1 });
  expect(
    commandForIssuePageKey(
      { key: " ", shiftKey: true },
      current.id,
      targets,
      [],
    ),
  ).toEqual({ kind: "scroll", direction: -1 });
});

it("moves between the issue and its breadcrumb and opens the focused destination", () => {
  expect(
    commandForIssuePageKey(
      { key: "k", shiftKey: false },
      current.id,
      targets,
      [],
    ),
  ).toEqual({ kind: "select", issueId: "parent" });
  expect(
    commandForIssuePageKey(
      { key: "Enter", shiftKey: false },
      "parent",
      targets,
      [],
    ),
  ).toEqual({ kind: "openIssue", issue: ancestor });
  expect(
    commandForIssuePageKey(
      { key: "o", shiftKey: false },
      current.id,
      targets,
      [],
    ),
  ).toEqual({ kind: "openOnGitHub", url: current.url });
});

describe("the cursor as the page changes under it", () => {
  /** The cursor placed on an issue, among a page's targets. */
  function placed(targets: string[], cursor: string): CursorPlace {
    return { targets, placed: cursor, shownOn: cursor };
  }

  it("stays on its issue wherever it moves", () => {
    const moved = followCursor(
      placed(["a", "b", "c"], "b"),
      ["b", "a", "c"],
      "b",
    );
    expect(moved.shownOn).toBe("b");
  });

  it("moves to the nearest issue below one that disappeared, and stays there", () => {
    const gone = followCursor(placed(["a", "b", "c"], "b"), ["a", "c"], "b");
    expect(gone.shownOn).toBe("c");
    expect(followCursor(gone, ["x", "a", "c"], "b").shownOn).toBe("c");
  });

  it("stays on an issue that has not loaded yet", () => {
    expect(
      followCursor(placed(["page"], "b"), ["page", "a", "b"], "b").shownOn,
    ).toBe("b");
  });

  it("goes where the user moves it", () => {
    const gone = followCursor(placed(["a", "b", "c"], "b"), ["a", "c"], "b");
    expect(followCursor(gone, gone.targets, "a").shownOn).toBe("a");
  });
});
