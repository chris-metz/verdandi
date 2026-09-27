import { expect, it } from "vitest";
import { listStatus } from "./list-status";

const updatedAt = Date.parse("2026-09-27T14:02:00Z");

it("says it is loading until everything has arrived", () => {
  expect(listStatus({ status: "loading" })).toBe("Loading…");
});

it("counts the open issues once they are loaded", () => {
  expect(
    listStatus({
      status: "current",
      updatedAt,
      openIssues: 1,
      closedNotListed: 0,
    }),
  ).toBe("1 open issue");
  expect(
    listStatus({
      status: "current",
      updatedAt,
      openIssues: 1234,
      closedNotListed: 0,
    }),
  ).toBe("1,234 open issues");
});

it("keeps the counts while the list is read again", () => {
  expect(
    listStatus({
      status: "refreshing",
      updatedAt,
      openIssues: 3,
      closedNotListed: 0,
    }),
  ).toBe("3 open issues");
});

it("says there are no open issues only once loading succeeded", () => {
  expect(
    listStatus({
      status: "current",
      updatedAt,
      openIssues: 0,
      closedNotListed: 0,
    }),
  ).toBe("No open issues");
});

it("says how many closed issues are not listed", () => {
  expect(
    listStatus({
      status: "current",
      updatedAt,
      openIssues: 12,
      closedNotListed: 1,
    }),
  ).toBe(
    "12 open issues · 1 closed issue with no open sub-issues is not listed",
  );
  expect(
    listStatus({
      status: "current",
      updatedAt,
      openIssues: 0,
      closedNotListed: 1520,
    }),
  ).toBe(
    "No open issues · 1,520 closed issues with no open sub-issues are not listed",
  );
});

it("says why loading failed", () => {
  expect(listStatus({ status: "failed", message: "Cannot reach GitHub" })).toBe(
    "Cannot reach GitHub",
  );
});
