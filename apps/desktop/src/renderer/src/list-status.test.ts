import type { IssueList, IssueSummary } from "@verdandi/core/contract";
import { expect, it } from "vitest";
import { listStatus } from "./list-status";

function listOf(count: number, loading: IssueList["loading"]): IssueList {
  const issues = Array.from({ length: count }, (_, index): IssueSummary => ({
    id: `I_${String(index)}`,
    number: index + 1,
    title: `Issue ${String(index + 1)}`,
    state: "open",
  }));
  return {
    scope: { kind: "repository", repository: { owner: "acme", name: "api" } },
    issues,
    loading,
  };
}

it("says it is loading until the last page has arrived", () => {
  expect(listStatus(listOf(0, { status: "loading" }))).toBe("Loading…");
  expect(listStatus(listOf(100, { status: "loading" }))).toBe("Loading…");
});

it("counts the open issues once they are loaded", () => {
  expect(listStatus(listOf(1, { status: "loaded" }))).toBe("1 open issue");
  expect(listStatus(listOf(1234, { status: "loaded" }))).toBe(
    "1,234 open issues",
  );
});

it("says there are no open issues only once loading succeeded", () => {
  expect(listStatus(listOf(0, { status: "loaded" }))).toBe("No open issues");
});

it("says why loading failed", () => {
  expect(
    listStatus(
      listOf(100, { status: "failed", message: "Cannot reach GitHub" }),
    ),
  ).toBe("Cannot reach GitHub");
});
