import type {
  RepositoryAddress,
  RepositoryEntry,
} from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import type { SidebarScope as Scope } from "./scope";
import {
  countLabel,
  entryOrder,
  followSelection,
  matchCountLabel,
} from "./sidebar-entries";

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

describe("following the selected entry", () => {
  const repository = (
    nameWithOwner: string,
    id?: number,
  ): Scope & { kind: "repository" } => {
    const [owner = "", name = ""] = nameWithOwner.split("/");
    return {
      kind: "repository",
      repository: { owner, name, ...(id === undefined ? {} : { id }) },
    };
  };
  const noRenames = new Map<string, RepositoryAddress>();

  it("keeps an entry that is still there as the sidebar has it now", () => {
    const view = {
      kind: "view" as const,
      view: { id: "v", name: "New", query: "q" },
    };
    expect(
      followSelection(
        { kind: "view", view: { id: "v", name: "Old", query: "q" } },
        [{ kind: "all" }, view],
        noRenames,
      ),
    ).toBe(view);
    expect(
      followSelection({ kind: "all" }, [{ kind: "all" }], noRenames),
    ).toEqual({
      kind: "all",
    });
  });

  it("follows a repository to its new name by its ID, or when only its case changed", () => {
    const renamed = repository("newco/api", 7);
    expect(
      followSelection(
        repository("acme/api", 7),
        [{ kind: "all" }, renamed],
        noRenames,
      ),
    ).toBe(renamed);
    const corrected = repository("acme/api", 7);
    expect(
      followSelection(repository("Acme/API"), [corrected], noRenames),
    ).toBe(corrected);
  });

  it("follows a repository selected without its ID through the renames the core announced", () => {
    const renamed = repository("newco/api", 7);
    expect(
      followSelection(
        repository("acme/api"),
        [renamed],
        new Map([
          ["acme/api", { owner: "acme", name: "api-v2" }],
          ["acme/api-v2", { owner: "newco", name: "api" }],
        ]),
      ),
    ).toBe(renamed);
  });

  it("finds no entry that is gone", () => {
    expect(
      followSelection(
        repository("acme/api", 7),
        [repository("acme/web", 8)],
        noRenames,
      ),
    ).toBeUndefined();
  });
});
