import { expect, it } from "vitest";
import type { IssueNode, IssueTree } from "@verdandi/core/contract";
import {
  createFindReveals,
  pathToTextMatch,
  withFindReveals,
} from "./find-reveals";
import { visibleRows } from "./list-navigation";

function node(id: string, subIssues: IssueNode[] = []): IssueTree {
  return {
    issue: {
      id,
      title: id,
      reference: `#${id}`,
      state: "open",
      url: `https://github.com/acme/api/issues/${id}`,
      repository: { owner: "acme", name: "api" },
      external: false,
      author: undefined,
      createdAt: "2026-10-01T12:00:00Z",
      labels: [],
      subIssueProgress: { closed: 0, total: subIssues.length },
      blockedBy: { open: 0, total: 0 },
      blocking: { open: 0, total: 0 },
      incomplete: undefined,
    },
    expanded: false,
    subIssues,
    parent: undefined,
  };
}

it("reveals only this tab's ancestor path and lets shared manual actions override it even in inactive tabs", () => {
  const trees = [node("1", [node("2", [node("3")])]), node("4", [node("5")])];
  const reveals = createFindReveals();
  const path = pathToTextMatch(trees, "3");
  expect(path).toEqual(["1", "2"]);
  reveals.open(1, "All:open", path);
  expect(
    visibleRows(withFindReveals(trees, reveals.get(1, "All:open"))).map(
      ({ node }) => node.issue.id,
    ),
  ).toEqual(["1", "2", "3", "4"]);
  expect(
    visibleRows(withFindReveals(trees, reveals.get(2, "All:open"))).map(
      ({ node }) => node.issue.id,
    ),
  ).toEqual(["1", "4"]);
  expect(reveals.get(1, "All:closed")).toEqual([]);
  reveals.open(1, "All:open", ["4"]);
  reveals.manual("All:open", trees, "1");
  expect(reveals.get(1, "All:open")).toEqual(["4"]);
  reveals.manual("All:open", trees);
  expect(reveals.get(1, "All:open")).toEqual([]);
});

it("keeps each tab's paths when its repository is renamed, and drops a removed entry", () => {
  const reveals = createFindReveals();
  reveals.open(1, "acme/old:open", ["parent"]);
  reveals.open(2, "acme/old:closed", ["another"]);
  reveals.moveScope("acme/old", "acme/new");
  expect(reveals.get(1, "acme/new:open")).toEqual(["parent"]);
  expect(reveals.get(2, "acme/new:closed")).toEqual(["another"]);
  expect(reveals.get(1, "acme/old:open")).toEqual([]);
  reveals.forgetScope("acme/new");
  expect(reveals.get(1, "acme/new:open")).toEqual([]);
});
