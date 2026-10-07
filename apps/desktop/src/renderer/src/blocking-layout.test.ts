import { expect, it } from "vitest";
import type { BlockingMap, IssueSummary } from "@verdandi/core/contract";
import { layoutBlockingMap, mapSizes } from "./blocking-layout";

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
const overTheTop = (path: string) =>
  new RegExp(` ${String(mapSizes(14).laneTop)} `).test(path);

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
  const layout = await layoutBlockingMap(map, "root", 14);
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
  const layout = await layoutBlockingMap(map, "root", 14);
  const route = (from: string, to: string) =>
    layout.arrows.find((arrow) => arrow.from === from && arrow.to === to)
      ?.path ?? "";
  expect(overTheTop(route("root", "near"))).toBe(false);
  expect(overTheTop(route("near", "root"))).toBe(true);
});

it.each([
  // The smallest text size, the default, and the largest.
  [11, { width: 175, height: 102, columns: 225, gap: 25, top: 55, lane: 39 }],
  [14, { width: 216, height: 112, columns: 280, gap: 32, top: 64, lane: 44 }],
  [20, { width: 297, height: 133, columns: 388, gap: 46, top: 83, lane: 54 }],
])(
  "sizes the cards, columns and gaps for text of %ipx, but keeps the padding",
  async (textSize, expected) => {
    // Two issues block the root, one above the other, and a cycle takes
    // the lane above the columns.
    const map: BlockingMap = {
      cards: [
        { issue: issue("root"), step: 0, badges: {} },
        { issue: issue("first"), step: -1, badges: {} },
        { issue: issue("second"), step: -1, badges: {} },
      ],
      edges: [
        { from: "first", to: "root", cycle: false, closed: false },
        { from: "second", to: "root", cycle: false, closed: false },
        { from: "root", to: "first", cycle: true, closed: false },
      ],
      ends: { blockedBy: { kind: "none" }, blocking: { kind: "none" } },
      problems: [],
    };
    const layout = await layoutBlockingMap(map, "root", textSize);
    const card = (id: string) => {
      const found = layout.cards.find((each) => each.id === `map:${id}`);
      if (!found) throw new Error(`No card ${id}`);
      return found;
    };
    const root = layout.cards.find(({ id }) => id === "root");
    const [upper, lower] = [card("first"), card("second")].sort(
      (a, b) => a.y - b.y,
    );
    if (!root || !upper || !lower) throw new Error("A card is missing");
    expect({ width: root.width, height: root.height }).toEqual({
      width: expected.width,
      height: expected.height,
    });
    expect(root.x - upper.x).toBe(expected.columns);
    expect(lower.y - (upper.y + upper.height)).toBe(expected.gap);
    expect(upper.y).toBe(expected.top);
    expect(layout.columns[0]?.x).toBe(28);
    const cycle = layout.arrows.find((arrow) => arrow.cycle);
    expect(cycle?.path).toContain(` ${String(expected.lane)} `);
  },
);
