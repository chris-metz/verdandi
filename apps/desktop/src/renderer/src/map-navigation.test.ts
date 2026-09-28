import { expect, it } from "vitest";
import { spatialNeighbour } from "./map-navigation";
import { commandForIssuePageKey } from "./issue-page-navigation";

const centre = {
  id: "centre",
  step: 0,
  x: 300,
  y: 140,
  width: 200,
  height: 100,
  issue: {
    id: "centre",
    title: "Centre",
    reference: "#1",
    url: "https://github.com/acme/api/issues/1",
  },
};
const cards = [
  { id: "left-high", step: -1, x: 0, y: 0, width: 200, height: 100 },
  { id: "left-low", step: -1, x: 0, y: 150, width: 200, height: 100 },
  centre,
  { id: "right", step: 1, x: 600, y: 40, width: 200, height: 100 },
  { id: "edge:blocking", step: 3, x: 900, y: 40, width: 200, height: 100 },
];

it("moves horizontally to the nearest column and vertically within a column", () => {
  expect(spatialNeighbour(cards, "centre", "left")).toBe("left-low");
  expect(spatialNeighbour(cards, "left-low", "up")).toBe("left-high");
  expect(spatialNeighbour(cards, "centre", "right")).toBe("right");
  expect(spatialNeighbour(cards, "right", "right")).toBe("edge:blocking");
  expect(spatialNeighbour(cards, "edge:blocking", "right")).toBeUndefined();
});

it("uses map coordinates for arrows and hjkl, treats the edge as a stop, and opens the selected issue", () => {
  const key = (key: string, cursor = "centre") =>
    commandForIssuePageKey(
      { key, shiftKey: false },
      cursor,
      [centre.issue],
      [],
      cards,
    );
  expect(key("h")).toEqual({ kind: "select", issueId: "left-low" });
  expect(key("ArrowRight")).toEqual({ kind: "select", issueId: "right" });
  expect(key("k", "left-low")).toEqual({
    kind: "select",
    issueId: "left-high",
  });
  expect(key("Enter")).toEqual({ kind: "openIssue", issue: centre.issue });
  expect(key("o")).toEqual({ kind: "openOnGitHub", url: centre.issue.url });
  expect(key("Enter", "edge:blocking")).toBeUndefined();
  expect(key("o", "edge:blocking")).toBeUndefined();
  expect(key("l", "edge:blocking")).toBeUndefined();
});

it("moves down from the map into sub-issues and back up to the centre", () => {
  const sub = {
    issue: {
      id: "sub",
      reference: "#2",
      title: "Sub-issue",
      repository: { owner: "acme", name: "api" },
      state: "open" as const,
      external: false,
      url: "https://github.com/acme/api/issues/2",
    },
    parent: undefined,
    subIssues: [] as [],
    expanded: false as const,
    unread: { status: "loading" as const },
  };
  const targets = [centre.issue, sub.issue];
  expect(
    commandForIssuePageKey(
      { key: "j", shiftKey: false },
      "centre",
      targets,
      [sub],
      cards,
    ),
  ).toEqual({ kind: "select", issueId: "sub" });
  expect(
    commandForIssuePageKey(
      { key: "k", shiftKey: false },
      "sub",
      targets,
      [sub],
      cards,
    ),
  ).toEqual({ kind: "select", issueId: "centre" });
});
