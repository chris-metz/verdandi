import type { RepositoryEntry } from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import { countLabel, entryOrder, matchCountLabel } from "./sidebar-entries";

function entry(owner: string, name: string): RepositoryEntry {
  return {
    repository: { owner, name },
    openIssues: { status: "known", count: 1 },
  };
}

describe("entry order", () => {
  it("starts with All, then lists the Repositories section in the settings file's order, with counts", () => {
    expect(
      entryOrder({
        status: "read",
        views: [],
        settings: { status: "writable" },
        firstLaunch: false,
        all: { openIssues: { status: "known", count: 3 } },
        repositories: [
          entry("acme", "web"),
          entry("acme", "api"),
          entry("octo-org", "tools"),
        ],
      }),
    ).toEqual([
      {
        scope: { kind: "all" },
        openIssues: { status: "known", count: 3 },
      },
      {
        scope: {
          kind: "repository",
          repository: { owner: "acme", name: "web" },
        },
        openIssues: { status: "known", count: 1 },
      },
      {
        scope: {
          kind: "repository",
          repository: { owner: "acme", name: "api" },
        },
        openIssues: { status: "known", count: 1 },
      },
      {
        scope: {
          kind: "repository",
          repository: { owner: "octo-org", name: "tools" },
        },
        openIssues: { status: "known", count: 1 },
      },
    ]);
  });

  it("has only All before the sidebar is read, or when it failed", () => {
    expect(entryOrder(undefined)).toEqual([
      { scope: { kind: "all" }, openIssues: { status: "loading" } },
    ]);
    expect(
      entryOrder({ status: "failed", message: "settings.json is broken" }),
    ).toEqual([
      {
        scope: { kind: "all" },
        openIssues: { status: "failed", message: "settings.json is broken" },
      },
    ]);
  });
});

describe("count label", () => {
  it("shows a known count", () => {
    expect(countLabel({ status: "known", count: 7 })).toBe("7");
    expect(countLabel({ status: "known", count: 1234 })).toBe("1,234");
  });

  it("shows 0 only when GitHub said so", () => {
    expect(countLabel({ status: "known", count: 0 })).toBe("0");
    expect(countLabel({ status: "loading" })).toBe("–");
    expect(
      countLabel({ status: "failed", message: "Cannot reach GitHub" }),
    ).toBe("–");
  });
});

describe("views", () => {
  it("follow the Repositories section in the settings file's order, each with its last match count", () => {
    const bugs = { id: "bugs", name: "Bugs", query: "label:bug" };
    const mine = { id: "mine", name: "Mine", query: "assignee:@me" };
    expect(
      entryOrder({
        status: "read",
        views: [
          { view: bugs, matches: { status: "known", count: 4213 } },
          { view: mine, matches: { status: "unknown" } },
        ],
        settings: { status: "writable" },
        firstLaunch: false,
        all: { openIssues: { status: "known", count: 1 } },
        repositories: [entry("acme", "api")],
      }).slice(2),
    ).toEqual([
      {
        scope: { kind: "view", view: bugs },
        matches: { status: "known", count: 4213 },
      },
      { scope: { kind: "view", view: mine }, matches: { status: "unknown" } },
    ]);
  });

  it("show GitHub's total abbreviated, and – until the view has run", () => {
    expect(
      [0, 7, 999, 1000, 4213, 42_130, 1_234_567].map((count) =>
        matchCountLabel({ status: "known", count }),
      ),
    ).toEqual(["0", "7", "999", "1k", "4.2k", "42.1k", "1.2M"]);
    expect(matchCountLabel({ status: "unknown" })).toBe("–");
  });
});
