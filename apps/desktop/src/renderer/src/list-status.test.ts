import type { ListLoading } from "@verdandi/core/contract";
import { expect, it } from "vitest";
import { listStatus } from "./list-status";

const updatedAt = Date.parse("2026-09-27T14:02:00Z");

/** The line under an open list. */
function openStatus(loading: ListLoading): string {
  return listStatus(loading, "open");
}

it("says it is loading until everything has arrived", () => {
  expect(openStatus({ status: "loading" })).toBe("Loading…");
});

it("counts the open issues once they are loaded", () => {
  expect(
    openStatus({
      status: "current",
      updatedAt,
      matches: 1,
      closedNotListed: 0,
    }),
  ).toBe("1 open issue");
  expect(
    openStatus({
      status: "current",
      updatedAt,
      matches: 1234,
      closedNotListed: 0,
    }),
  ).toBe("1,234 open issues");
});

it("keeps the counts while the list is read again", () => {
  expect(
    openStatus({
      status: "refreshing",
      updatedAt,
      matches: 3,
      closedNotListed: 0,
    }),
  ).toBe("3 open issues");
});

it("says there are no open issues only once loading succeeded", () => {
  expect(
    openStatus({
      status: "current",
      updatedAt,
      matches: 0,
      closedNotListed: 0,
    }),
  ).toBe("No open issues");
});

it("says how many closed issues are not listed", () => {
  expect(
    openStatus({
      status: "current",
      updatedAt,
      matches: 12,
      closedNotListed: 1,
    }),
  ).toBe(
    "12 open issues · 1 closed issue with no open sub-issues is not listed",
  );
  expect(
    openStatus({
      status: "current",
      updatedAt,
      matches: 0,
      closedNotListed: 1520,
    }),
  ).toBe(
    "No open issues · 1,520 closed issues with no open sub-issues are not listed",
  );
});

it("says the open issues listed are not all, and why, when loading failed after some", () => {
  expect(
    openStatus({
      status: "failed",
      problem: { kind: "unreachable", message: "no such host" },
    }),
  ).toBe("Not every open issue could be loaded · Cannot reach GitHub");
});

it("keeps the counts of what a stale list shows", () => {
  expect(
    openStatus({
      status: "stale",
      updatedAt,
      problem: { kind: "unreachable", message: "no such host" },
      matches: 3,
      closedNotListed: 0,
    }),
  ).toBe("3 open issues");
});

it("says how many closed issues have been read while a closed list loads", () => {
  expect(listStatus({ status: "loading" }, "closed")).toBe(
    "Loading closed issues…",
  );
  expect(
    listStatus(
      { status: "loading", progress: { read: 300, total: 2140 } },
      "closed",
    ),
  ).toBe("Loading closed issues… 300 of 2,140");
  expect(
    listStatus(
      { status: "loading", progress: { read: 300, total: undefined } },
      "closed",
    ),
  ).toBe("Loading closed issues…");
});

it("counts the closed issues of a closed list", () => {
  expect(
    listStatus(
      { status: "current", updatedAt, matches: 1, closedNotListed: 0 },
      "closed",
    ),
  ).toBe("1 closed issue");
  expect(
    listStatus(
      { status: "refreshing", updatedAt, matches: 2140, closedNotListed: 0 },
      "closed",
    ),
  ).toBe("2,140 closed issues");
  expect(
    listStatus(
      { status: "current", updatedAt, matches: 0, closedNotListed: 0 },
      "closed",
    ),
  ).toBe("No closed issues");
});

it("says the closed issues listed are not all when loading failed after some", () => {
  expect(
    listStatus(
      {
        status: "failed",
        problem: { kind: "unreachable", message: "no such host" },
      },
      "closed",
    ),
  ).toBe("Not every closed issue could be loaded · Cannot reach GitHub");
});
