import type { IssueList, ListLoading } from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import { listFreshness, loadingFreshness, updatedAgo } from "./freshness";

const now = Date.parse("2026-09-27T14:02:00Z");
const minute = 60 * 1000;

/** All's list, loading its repositories, of which `loaded` have loaded. */
function allLoading(loaded: number, total: number): IssueList {
  return {
    scope: { kind: "all" },
    trees: [],
    loading: { status: "loading" },
    repositories: Array.from({ length: total }, (_, index) => ({
      repository: { owner: "acme", name: `repo-${String(index)}` },
      loading:
        index < loaded
          ? { status: "current", updatedAt: now }
          : { status: "loading" },
    })),
  };
}

function repositoryList(loading: ListLoading): IssueList {
  return {
    scope: {
      kind: "repository",
      repository: { owner: "acme", name: "api" },
    },
    trees: [],
    loading,
    repositories: [],
  };
}

describe("a list's header", () => {
  it("counts All's repositories while they load", () => {
    expect(listFreshness(allLoading(3, 14), now)).toEqual({
      text: "Loading… 3 of 14 repositories",
      busy: true,
    });
    expect(listFreshness(allLoading(0, 1), now)).toEqual({
      text: "Loading… 0 of 1 repository",
      busy: true,
    });
  });

  it("says a repository's list is loading", () => {
    expect(listFreshness(repositoryList({ status: "loading" }), now)).toEqual({
      text: "Loading…",
      busy: true,
    });
  });

  it("gives the age of what a list shows, also while it is read again", () => {
    const loaded = {
      updatedAt: now - 3 * minute,
      openIssues: 2,
      closedNotListed: 0,
    };
    expect(
      listFreshness(repositoryList({ status: "current", ...loaded }), now),
    ).toEqual({ text: "Updated 3 min ago", busy: false });
    expect(
      listFreshness(repositoryList({ status: "refreshing", ...loaded }), now),
    ).toEqual({ text: "Updated 3 min ago", busy: true });
  });

  it("leaves a failure to the list itself", () => {
    expect(
      listFreshness(
        repositoryList({ status: "failed", message: "Cannot reach GitHub" }),
        now,
      ),
    ).toEqual({ text: "", busy: false });
  });
});

describe("an issue page's header", () => {
  it("says it is loading, then gives its age", () => {
    expect(loadingFreshness({ status: "loading" }, now)).toEqual({
      text: "Loading…",
      busy: true,
    });
    expect(
      loadingFreshness({ status: "refreshing", updatedAt: now }, now),
    ).toEqual({ text: "Updated just now", busy: true });
    expect(
      loadingFreshness({ status: "current", updatedAt: now - minute }, now),
    ).toEqual({ text: "Updated 1 min ago", busy: false });
  });
});

describe("the age of data", () => {
  it("is just now within the first minute", () => {
    expect(updatedAgo(now, now)).toBe("Updated just now");
    expect(updatedAgo(now - minute + 1, now)).toBe("Updated just now");
  });

  it("counts whole minutes within the first hour", () => {
    expect(updatedAgo(now - minute, now)).toBe("Updated 1 min ago");
    expect(updatedAgo(now - 59 * minute - 59_000, now)).toBe(
      "Updated 59 min ago",
    );
  });

  it("counts whole hours after that", () => {
    expect(updatedAgo(now - 60 * minute, now)).toBe("Updated 1 h ago");
    expect(updatedAgo(now - 26 * 60 * minute, now)).toBe("Updated 26 h ago");
  });

  it("is just now when the clock went back", () => {
    expect(updatedAgo(now + minute, now)).toBe("Updated just now");
  });
});
