import type {
  IssueList,
  IssuePage,
  ListLoading,
  LoadingState,
} from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import {
  listFreshness,
  loadingFreshness,
  pageFreshness,
  updatedAgo,
} from "./freshness";

/** 14:32 on the machine's clock, wherever it is. */
const now = new Date(2026, 8, 27, 14, 32).getTime();
const minute = 60 * 1000;
const cannotReachGitHub = {
  kind: "unreachable",
  message: "dial tcp: lookup api.github.com: no such host",
} as const;

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
      retry: false,
    });
    expect(listFreshness(allLoading(0, 1), now)).toEqual({
      text: "Loading… 0 of 1 repository",
      busy: true,
      retry: false,
    });
  });

  it("says a repository's list is loading", () => {
    expect(listFreshness(repositoryList({ status: "loading" }), now)).toEqual({
      text: "Loading…",
      busy: true,
      retry: false,
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
    ).toEqual({ text: "Updated 3 min ago", busy: false, retry: false });
    expect(
      listFreshness(repositoryList({ status: "refreshing", ...loaded }), now),
    ).toEqual({ text: "Updated 3 min ago", busy: true, retry: false });
  });

  it("leaves a failure to the list itself", () => {
    expect(
      listFreshness(
        repositoryList({ status: "failed", problem: cannotReachGitHub }),
        now,
      ),
    ).toEqual({ text: "", busy: false, retry: false });
  });

  it("says since when a stale list shows what it read, and why it could not read it again", () => {
    expect(
      listFreshness(
        repositoryList({
          status: "stale",
          updatedAt: now - 30 * minute,
          problem: cannotReachGitHub,
          openIssues: 2,
          closedNotListed: 0,
        }),
        now,
      ),
    ).toEqual({
      text: "Showing data from 14:02 · Cannot reach GitHub",
      detail: cannotReachGitHub.message,
      busy: false,
      retry: true,
    });
  });

  it("gives the date too when stale data is from another day", () => {
    expect(
      listFreshness(
        repositoryList({
          status: "stale",
          updatedAt: new Date(2026, 8, 26, 9, 5).getTime(),
          problem: cannotReachGitHub,
          openIssues: 2,
          closedNotListed: 0,
        }),
        now,
      ).text,
    ).toBe("Showing data from Sep 26, 09:05 · Cannot reach GitHub");
  });

  it("sums up what of a list could not be read", () => {
    const list: IssueList = {
      ...allLoading(2, 4),
      loading: {
        status: "current",
        updatedAt: now - 3 * minute,
        openIssues: 2,
        closedNotListed: 0,
      },
      repositories: [
        { status: "current", updatedAt: now },
        {
          status: "failed",
          problem: { kind: "unavailable", access: undefined },
        },
        {
          status: "failed",
          problem: { kind: "unavailable", access: undefined },
        },
        { status: "failed", problem: cannotReachGitHub },
      ].map((loading, index) => ({
        repository: { owner: "acme", name: `repo-${String(index)}` },
        loading: loading as LoadingState,
      })),
    };

    expect(listFreshness(list, now)).toEqual({
      text: "Updated 3 min ago · 2 repositories unavailable · 1 repository could not be loaded",
      busy: false,
      retry: true,
    });
  });
});

describe("an issue page's header", () => {
  it("says it is loading, then gives its age", () => {
    expect(loadingFreshness({ status: "loading" }, now)).toEqual({
      text: "Loading…",
      busy: true,
      retry: false,
    });
    expect(
      loadingFreshness({ status: "refreshing", updatedAt: now }, now),
    ).toEqual({ text: "Updated just now", busy: true, retry: false });
    expect(
      loadingFreshness({ status: "current", updatedAt: now - minute }, now),
    ).toEqual({ text: "Updated 1 min ago", busy: false, retry: false });
  });

  it("says since when a stale page shows what it read", () => {
    expect(
      loadingFreshness(
        {
          status: "stale",
          updatedAt: now - 30 * minute,
          problem: { kind: "interrupted" },
        },
        now,
      ),
    ).toEqual({
      text: "Showing data from 14:02 · Loading was interrupted",
      detail: undefined,
      busy: false,
      retry: true,
    });
  });

  it("sums up the parts of a page that could not be read", () => {
    const failed = {
      status: "failed",
      problem: { kind: "unavailable", access: undefined },
    } as const;
    const identity = {
      repository: { owner: "acme", name: "api" },
      state: "open",
      external: false,
    } as const;
    const page: IssuePage = {
      issueId: "I_2",
      issue: undefined,
      ancestry: [
        {
          id: "I_1",
          url: "https://github.com/acme/api/issues/1",
          reference: "acme/api#1",
          title: "Parent",
          external: false,
          unread: failed,
        },
      ],
      subIssues: [
        {
          issue: {
            ...identity,
            id: "I_3",
            reference: "#3",
            title: "Sub-issue",
            url: "https://github.com/acme/api/issues/3",
          },
          subIssues: [],
          expanded: false,
          parent: undefined,
          unread: failed,
        },
      ],
      loading: { status: "current", updatedAt: now },
    };

    expect(pageFreshness(page, now)).toEqual({
      text: "Updated just now · 2 issues unavailable",
      busy: false,
      retry: true,
    });
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
