import type { RecentIssue } from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import {
  afterLookUp,
  goToChoices,
  issueLocator,
  openedIssue,
  recentIssueOf,
  tabEntryOf,
} from "./go-to-issue";
import type { SidebarScope as Scope } from "./scope";

const api = { owner: "acme", name: "api" };

describe("reading the Go to Issue field", () => {
  it("takes a number in the repository of the tab, with or without #", () => {
    expect(issueLocator("#12")).toEqual({ repository: undefined, number: 12 });
    expect(issueLocator(" 7 ")).toEqual({ repository: undefined, number: 7 });
  });

  it.each(["acme/api#12", "acme/api 12", "acme/api #12", " acme/api#12 "])(
    "takes owner/name and a number: %j",
    (text) => {
      expect(issueLocator(text)).toEqual({ repository: api, number: 12 });
    },
  );

  it("takes dots, dashes and underscores in owner/name", () => {
    expect(issueLocator("my-org/web.site_2#3")).toEqual({
      repository: { owner: "my-org", name: "web.site_2" },
      number: 3,
    });
  });

  it.each([
    "https://github.com/acme/api/issues/12",
    "https://github.com/acme/api/issues/12#issuecomment-99",
    "https://www.github.com/acme/api/issues/12/",
  ])("takes a link to an issue on GitHub: %j", (text) => {
    expect(issueLocator(text)).toEqual({ repository: api, number: 12 });
  });

  it.each([
    "",
    "#",
    "abc",
    "12a",
    "1.5",
    "-3",
    "0",
    "##12",
    "acme/api",
    "acme/api#",
    "acme#12",
    "a/b/c#12",
    "https://github.com/acme/api/pull/12",
    "https://example.com/acme/api/issues/12",
    "http://github.com/acme/api/issues/12",
  ])("takes nothing else: %j", (text) => {
    expect(issueLocator(text)).toBeUndefined();
  });

  it("takes no number GitHub could not have", () => {
    expect(issueLocator("2147483647")).toMatchObject({ number: 2147483647 });
    expect(issueLocator("2147483648")).toBeUndefined();
    expect(issueLocator("acme/api#2147483648")).toBeUndefined();
  });
});

/** A recent issue, by `owner/name#12`. */
function recent(reference: string, title = `Issue ${reference}`): RecentIssue {
  const [, owner = "", name = "", number = ""] =
    /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(reference) ?? [];
  return {
    id: `I_${reference}`,
    repository: { owner, name },
    number: Number(number),
    title,
  };
}

describe("what the palette offers", () => {
  const recents = [
    recent("acme/api#3", "Crash on start"),
    recent("acme/web#12", "Slow page"),
    recent("acme/api#12", "Login fails"),
  ];

  it("offers every recent issue while nothing is typed", () => {
    expect(goToChoices("", { from: undefined, recents })).toEqual({
      destinations: recents.map((issue) => ({ kind: "recent", issue })),
      hint: undefined,
    });
  });

  it("offers the issue typed first, then the recent issues matching by owner/name#12 or title", () => {
    expect(
      goToChoices("acme/web#1", { from: undefined, recents }).destinations,
    ).toEqual([
      {
        kind: "look-up",
        repository: { owner: "acme", name: "web" },
        number: 1,
      },
      { kind: "recent", issue: recents[1] },
    ]);
    expect(
      goToChoices("CRASH", { from: undefined, recents }).destinations,
    ).toEqual([{ kind: "recent", issue: recents[0] }]);
  });

  it("offers a recent issue typed as that recent issue, once", () => {
    expect(goToChoices("#12", { from: api, recents }).destinations).toEqual([
      { kind: "recent", issue: recents[2] },
      { kind: "recent", issue: recents[1] },
    ]);
    expect(
      goToChoices("https://github.com/ACME/API/issues/3", {
        from: undefined,
        recents,
      }).destinations,
    ).toEqual([{ kind: "recent", issue: recents[0] }]);
  });

  it("has #12 name the repository of the tab it was opened from", () => {
    expect(goToChoices("#4", { from: api, recents: [] })).toEqual({
      destinations: [{ kind: "look-up", repository: api, number: 4 }],
      hint: undefined,
    });
  });

  it("says that owner/name#12 is needed where the tab was no repository's", () => {
    expect(goToChoices("#4", { from: undefined, recents: [] })).toEqual({
      destinations: [],
      hint: "#4 names an issue only in a repository's tab: type owner/name#4.",
    });
  });

  it("says what it takes when what is typed names no issue", () => {
    expect(goToChoices("nothing", { from: api, recents })).toEqual({
      destinations: [],
      hint: "Type #12, owner/name#12 or a link to an issue on GitHub.",
    });
    expect(goToChoices("nothing", { from: undefined, recents })).toEqual({
      destinations: [],
      hint: "Type owner/name#12 or a link to an issue on GitHub.",
    });
  });
});

describe("opening an issue chosen", () => {
  const tracked = [{ owner: "Acme", name: "API", id: 42 }];

  it("opens over its repository's list when the repository is tracked, and over All otherwise", () => {
    expect(tabEntryOf(api, tracked)).toEqual({
      kind: "repository",
      repository: tracked[0],
    });
    expect(tabEntryOf({ owner: "acme", name: "web" }, tracked)).toEqual({
      kind: "all",
    });
  });

  it("names it as the list it opens over names it", () => {
    const issue = recent("acme/api#12", "Login fails");
    const own: Scope = { kind: "repository", repository: tracked[0] ?? api };
    expect(openedIssue(issue, own)).toEqual({
      id: "I_acme/api#12",
      reference: "#12",
      title: "Login fails",
      url: "https://github.com/acme/api/issues/12",
    });
    expect(openedIssue(issue, { kind: "all" })).toMatchObject({
      reference: "acme/api#12",
    });
  });
});

describe("recording a recent issue", () => {
  const web: Scope = {
    kind: "repository",
    repository: { owner: "acme", name: "web" },
  };

  it("knows an issue by its link", () => {
    expect(
      recentIssueOf(
        {
          id: "I_1",
          reference: "#1",
          title: "One",
          url: "https://github.com/acme/api/issues/1",
        },
        { kind: "all" },
      ),
    ).toEqual({ id: "I_1", repository: api, number: 1, title: "One" });
  });

  it("knows an issue opened without its link by its reference", () => {
    expect(
      recentIssueOf({ id: "I_2", reference: "acme/api#2", title: "Two" }, web),
    ).toEqual({ id: "I_2", repository: api, number: 2, title: "Two" });
    expect(
      recentIssueOf({ id: "I_3", reference: "#3", title: "Three" }, web),
    ).toEqual({
      id: "I_3",
      repository: { owner: "acme", name: "web" },
      number: 3,
      title: "Three",
    });
  });

  it("records none it cannot place", () => {
    expect(
      recentIssueOf(
        { id: "I_3", reference: "#3", title: "Three" },
        {
          kind: "all",
        },
      ),
    ).toBeUndefined();
  });
});

describe("what GitHub's answer does", () => {
  it("opens an issue it found", () => {
    const issue = {
      id: "I_12",
      reference: "acme/api#12",
      title: "Crash on start",
      url: "https://github.com/acme/api/issues/12",
    };
    expect(afterLookUp({ status: "found", issue })).toEqual({
      kind: "open",
      issue,
    });
  });

  it("opens a pull request on GitHub", () => {
    const url = "https://github.com/acme/api/pull/123";
    expect(afterLookUp({ status: "pull-request", url })).toEqual({
      kind: "pull-request",
      url,
    });
  });

  it("says why the issue could not be opened", () => {
    const problem = { kind: "unreachable", message: "offline" } as const;
    expect(afterLookUp({ status: "failed", problem })).toEqual({
      kind: "failed",
      problem,
    });
  });

  it("says nothing when the lookup was dropped, e.g. for another account, so that Enter asks again", () => {
    expect(
      afterLookUp({ status: "failed", problem: { kind: "interrupted" } }),
    ).toEqual({ kind: "idle" });
  });
});
