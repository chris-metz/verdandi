import type { Label } from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import {
  labelColors,
  labelOverflow,
  progressCell,
  relationshipCell,
} from "./row-cells";

const labels: Label[] = [
  { name: "bug", color: "d73a4a" },
  { name: "api", color: "0075ca" },
  { name: "security", color: "b60205" },
  { name: "docs", color: "0075ca" },
  { name: "needs design", color: "fef2c0" },
];

describe("labels", () => {
  it("show up to three", () => {
    expect(labelOverflow(labels.slice(0, 3))).toEqual({
      shown: labels.slice(0, 3),
      more: undefined,
    });
    expect(labelOverflow([])).toEqual({ shown: [], more: undefined });
  });

  it("count the rest as +N, naming them for the tooltip", () => {
    expect(labelOverflow(labels)).toEqual({
      shown: labels.slice(0, 3),
      more: { count: 2, names: "docs, needs design" },
    });
  });

  it("show GitHub's colour, with text that stays readable on it", () => {
    expect(labelColors("d73a4a")).toEqual({
      background: "#d73a4a",
      foreground: "#ffffff",
    });
    expect(labelColors("a2eeef")).toEqual({
      background: "#a2eeef",
      foreground: "#1f2328",
    });
  });

  it("fall back to grey for a colour that is not six hex digits", () => {
    expect(labelColors("red; background: url(x)")).toEqual({
      background: "#ededed",
      foreground: "#1f2328",
    });
  });
});

describe("sub-issue progress", () => {
  it("shows the closed share and closed/total", () => {
    expect(progressCell({ closed: 1, total: 4 })).toEqual({
      fraction: 0.25,
      text: "1/4",
    });
  });

  it("stays empty without sub-issues", () => {
    expect(progressCell({ closed: 0, total: 0 })).toBeUndefined();
  });
});

describe("blocking columns", () => {
  it("count open relationships of an open issue", () => {
    expect(
      relationshipCell("blockedBy", "open", { open: 2, total: 3 }),
    ).toEqual({ live: true, text: "2" });
    expect(relationshipCell("blocking", "open", { open: 1, total: 1 })).toEqual(
      { live: true, text: "1" },
    );
  });

  it("show open/total, muted, when none is live", () => {
    expect(
      relationshipCell("blockedBy", "open", { open: 0, total: 2 }),
    ).toEqual({ live: false, text: "0/2" });
    expect(relationshipCell("blocking", "open", { open: 0, total: 1 })).toEqual(
      { live: false, text: "0/1" },
    );
    // A closed issue no longer waits, but its blockers may still be open.
    expect(
      relationshipCell("blockedBy", "closed", { open: 1, total: 1 }),
    ).toEqual({ live: false, text: "1/1" });
  });

  it("show nothing waiting on a closed issue", () => {
    expect(
      relationshipCell("blocking", "closed", { open: 1, total: 2 }),
    ).toEqual({ live: false, text: "0/2" });
  });

  it("stay empty without relationships", () => {
    expect(
      relationshipCell("blockedBy", "open", { open: 0, total: 0 }),
    ).toBeUndefined();
    expect(
      relationshipCell("blocking", "closed", { open: 0, total: 0 }),
    ).toBeUndefined();
  });
});
