import { expect, it } from "vitest";
import type { BlockingMap, IssueSummary } from "@verdandi/core/contract";
import { layoutBlockingMap } from "./blocking-layout";

function issue(id: string): IssueSummary {
  return {
    id,
    repository: { owner: "acme", name: "api" },
    reference: `#${id}`,
    title: id,
    state: "open",
    url: `https://github.com/acme/api/issues/${id}`,
    external: false,
    author: undefined,
    createdAt: "2026-09-01T00:00:00Z",
    labels: [],
    subIssueProgress: { closed: 0, total: 0 },
    blockedBy: { open: 0, total: 0 },
    blocking: { open: 0, total: 0 },
    incomplete: undefined,
  };
}

/** Whether an arrow's path climbs to the lane above the columns. */
const overTheTop = (path: string) => / 44 /.test(path);

it("runs arrows straight to the edge cards past empty columns while a map loads", async () => {
  const map: BlockingMap = {
    cards: [
      {
        issue: issue("root"),
        step: 0,
        badges: {
          blockedBy: { kind: "loading" },
          blocking: { kind: "loading" },
        },
      },
    ],
    edges: [],
    ends: { blockedBy: { kind: "unknown" }, blocking: { kind: "unknown" } },
    problems: [],
  };
  const layout = await layoutBlockingMap(map, "root");
  expect(layout.arrows.map(({ from, to }) => [from, to])).toEqual([
    ["edge:blockedBy", "root"],
    ["root", "edge:blocking"],
  ]);
  for (const arrow of layout.arrows) expect(overTheTop(arrow.path)).toBe(false);
});

it("keeps the lane above the columns for cycles", async () => {
  const map: BlockingMap = {
    cards: [
      { issue: issue("root"), step: 0, badges: {} },
      { issue: issue("near"), step: 1, badges: {} },
    ],
    edges: [
      { from: "root", to: "near", cycle: false, closed: false },
      { from: "near", to: "root", cycle: true, closed: false },
    ],
    ends: { blockedBy: { kind: "none" }, blocking: { kind: "none" } },
    problems: [],
  };
  const layout = await layoutBlockingMap(map, "root");
  const route = (from: string, to: string) =>
    layout.arrows.find((arrow) => arrow.from === from && arrow.to === to)
      ?.path ?? "";
  expect(overTheTop(route("root", "near"))).toBe(false);
  expect(overTheTop(route("near", "root"))).toBe(true);
});
