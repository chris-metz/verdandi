import { expect, it } from "vitest";
import { commandForIssuePageKey } from "./issue-page-navigation";

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
