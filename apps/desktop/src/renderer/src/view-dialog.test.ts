import { describe, expect, it } from "vitest";
import {
  applyExample,
  dialogStart,
  scopeLine,
  viewExamples,
} from "./view-dialog";

describe("start", () => {
  const bugs = { id: "bugs", name: "Bugs", query: "is:open label:bug" };

  it("is empty for a new view, starting at its name", () => {
    expect(dialogStart({ kind: "new" })).toEqual({
      title: "New view",
      name: "",
      query: "",
      focus: "name",
      draft: {},
    });
  });

  it("is the view to edit, starting at its search and keeping its ID", () => {
    expect(dialogStart({ kind: "edit", view: bugs })).toEqual({
      title: "Edit view",
      name: "Bugs",
      query: "is:open label:bug",
      focus: "search",
      draft: { id: "bugs" },
    });
  });

  it("is a new view named after the one it duplicates, with its search, going right after it", () => {
    expect(dialogStart({ kind: "duplicate", view: bugs })).toEqual({
      title: "Duplicate view",
      name: "Bugs copy",
      query: "is:open label:bug",
      focus: "name",
      draft: { after: "bugs" },
    });
  });
});

describe("examples", () => {
  it("offer the searches the dialog suggests, with the tracked repositories' names", () => {
    expect(
      viewExamples([
        { owner: "acme", name: "api" },
        { owner: "acme", name: "web" },
      ]).map(({ query }) => query),
    ).toEqual([
      "is:open assignee:@me",
      "repo:acme/api is:open",
      "(repo:acme/api OR repo:acme/web) is:open",
      "org:acme is:open is:blocked",
      "is:open has:sub-issue",
      "parent-issue:acme/api#1",
      "is:open label:bug no:assignee sort:updated-desc",
    ]);
  });

  it("name placeholders while nothing is tracked", () => {
    expect(viewExamples([]).map(({ query }) => query)).toContain(
      "(repo:owner/repo OR repo:owner/other) is:open",
    );
  });

  it("replace the search and fill an empty name", () => {
    const offered = viewExamples([{ owner: "acme", name: "api" }]);
    const [mine, one] = offered;
    if (!mine || !one) throw new Error("Examples missing");

    expect(applyExample({ name: "", query: "label:x" }, mine, offered)).toEqual(
      {
        name: "Assigned to me",
        query: "is:open assignee:@me",
      },
    );
    expect(applyExample({ name: "Mine", query: "" }, one, offered)).toEqual({
      name: "Mine",
      query: "repo:acme/api is:open",
    });
  });

  it("replace a name an example filled, but not one the user typed", () => {
    const offered = viewExamples([{ owner: "acme", name: "api" }]);
    const [mine, one] = offered;
    if (!mine || !one) throw new Error("Examples missing");

    expect(
      applyExample({ name: "Assigned to me", query: mine.query }, one, offered),
    ).toEqual({ name: one.name, query: one.query });
    expect(
      applyExample({ name: "Assigned to me", query: "x" }, one, offered),
    ).toEqual({
      name: "Assigned to me",
      query: one.query,
    });
  });
});

describe("scope line", () => {
  it("says a search without repo:, org: or user: covers every repository, tracked or not", () => {
    expect(scopeLine("is:open assignee:@me")).toEqual({
      text: "Searches every repository you can read on GitHub, tracked or not.",
      warning: undefined,
    });
  });

  it("names what a search is limited to, which tracked repositories never change", () => {
    expect(scopeLine("(repo:acme/api OR org:octo) is:open").text).toBe(
      "Searches only acme/api or octo's repositories. Adding or removing tracked repositories never changes that.",
    );
    expect(scopeLine("repo:a/b OR repo:c/d OR user:e").text).toBe(
      "Searches only a/b, c/d or e's repositories. Adding or removing tracked repositories never changes that.",
    );
  });

  it("warns about repo: qualifiers side by side without OR", () => {
    expect(scopeLine("repo:acme/api repo:acme/web").warning).toBe(
      "Several repo: qualifiers without OR must all hold at once, so this matches nothing. Join them with OR: (repo:acme/api OR repo:acme/web).",
    );
  });
});
