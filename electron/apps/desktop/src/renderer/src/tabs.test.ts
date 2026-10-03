import type { RestoredTabs } from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import type { IssueDestination } from "./issue-navigation";
import type { SidebarScope as Scope } from "./scope";
import {
  restoredTabs,
  savedTabs,
  shownTab,
  tabTitle,
  updateTabs,
  type Tab,
  type TabAction,
  type TabState,
} from "./tabs";

const all: Scope = { kind: "all" };
function repository(name: string): Scope {
  return { kind: "repository", repository: { owner: "acme", name } };
}
const api = repository("api");
const web = repository("web");
const bugs: Scope = {
  kind: "view",
  view: { id: "bugs", name: "Bugs", query: "label:bug" },
};

/** An issue of `acme/api`, as its list names it. */
function issue(number: number): IssueDestination {
  return {
    id: `I_${String(number)}`,
    reference: `#${String(number)}`,
    title: `Issue ${String(number)}`,
    url: `https://github.com/acme/api/issues/${String(number)}`,
  };
}

/** The tabs restored from tabs on these entries, the first shown. */
function tabsOn(...entries: (Scope | "new")[]): TabState {
  return restoredTabs({
    tabs: entries.map((entry) =>
      entry === "new"
        ? { kind: "new", from: undefined }
        : { kind: "entry", entry, issues: [] },
    ),
    shown: 0,
  });
}

function apply(state: TabState, ...actions: TabAction[]): TabState {
  return actions.reduce(updateTabs, state);
}

/**
 * The row of tabs, each by its entry's label or `new`, with its issue
 * pages after a `>`, and the tab shown in brackets.
 */
function row(state: TabState): string[] {
  return state.tabs.map((tab) => {
    const entry =
      tab.entry === undefined
        ? "new"
        : tab.entry.kind === "repository"
          ? tab.entry.repository.name
          : tab.entry.kind === "view"
            ? tab.entry.view.name
            : "All";
    const pages = tab.stack.map((visit) => visit.issue.reference).join(" ");
    const label = pages ? `${entry} > ${pages}` : entry;
    return tab.id === state.shown ? `[${label}]` : label;
  });
}

function idAt(state: TabState, index: number): number {
  const tab = state.tabs[index];
  if (!tab) throw new Error(`No tab at ${String(index)}`);
  return tab.id;
}

describe("choosing a sidebar entry", () => {
  it("shows it in the tab shown, replacing what that tab showed", () => {
    const state = apply(
      tabsOn(api, web),
      { kind: "navigate", navigation: { kind: "open", issue: issue(1) } },
      { kind: "choose", entry: bugs },
    );
    expect(row(state)).toEqual(["[Bugs]", "web"]);
  });

  it("goes back to its list when it is the entry the tab shows already", () => {
    const state = apply(
      tabsOn(api),
      { kind: "navigate", navigation: { kind: "open", issue: issue(1) } },
      { kind: "choose", entry: repository("api") },
    );
    expect(row(state)).toEqual(["[api]"]);
  });

  it("turns a new tab into the entry's", () => {
    const state = apply(tabsOn("new"), { kind: "choose", entry: web });
    expect(row(state)).toEqual(["[web]"]);
    expect(shownTab(state)?.from).toBeUndefined();
  });

  it("opens it in a new tab in the background, after those opened from the tab shown", () => {
    const state = apply(
      tabsOn(api, web),
      { kind: "choose-in-new-tab", entry: bugs },
      { kind: "open-in-new-tab", issue: issue(2) },
      { kind: "choose-in-new-tab", entry: all },
    );
    expect(row(state)).toEqual(["[api]", "Bugs", "api > #2", "All", "web"]);
  });
});

describe("opening a new tab", () => {
  it("opens it at the end of the row and shows it", () => {
    const state = apply(tabsOn(api, web), { kind: "new" });
    expect(row(state)).toEqual(["api", "web", "[new]"]);
  });

  it("has #12 name the repository of the tab it was opened from", () => {
    expect(shownTab(apply(tabsOn(api), { kind: "new" }))?.from).toEqual(
      api.kind === "repository" ? api.repository : undefined,
    );
    expect(shownTab(apply(tabsOn(bugs), { kind: "new" }))?.from).toBe(
      undefined,
    );
    expect(
      shownTab(apply(tabsOn(api), { kind: "new" }, { kind: "new" }))?.from,
    ).toEqual({ owner: "acme", name: "api" });
  });

  it("opens an issue chosen in it over the list of the entry given, from which Back leads to that list", () => {
    const state = apply(
      tabsOn(web),
      { kind: "new" },
      {
        kind: "open-here",
        entry: api,
        issue: issue(3),
      },
      { kind: "navigate", navigation: { kind: "back" } },
    );
    expect(row(state)).toEqual(["web", "[api]"]);
  });
});

describe("Open in New Tab", () => {
  it("opens the issue page over the same entry's list, in the background", () => {
    const state = apply(
      tabsOn(bugs),
      { kind: "navigate", navigation: { kind: "open", issue: issue(1) } },
      { kind: "open-in-new-tab", issue: issue(2) },
    );
    expect(row(state)).toEqual(["[Bugs > #1]", "Bugs > #2"]);
  });

  it("puts each after the tabs already opened from the same tab, before the others", () => {
    const state = apply(
      tabsOn(api, web),
      { kind: "open-in-new-tab", issue: issue(1) },
      { kind: "open-in-new-tab", issue: issue(2) },
      { kind: "open-in-new-tab", issue: issue(3) },
    );
    expect(row(state)).toEqual([
      "[api]",
      "api > #1",
      "api > #2",
      "api > #3",
      "web",
    ]);
  });

  it("starts after the tab shown again for the tabs opened from another", () => {
    let state = apply(tabsOn(api, web), {
      kind: "open-in-new-tab",
      issue: issue(1),
    });
    state = apply(
      state,
      { kind: "show", id: idAt(state, 2) },
      { kind: "open-in-new-tab", issue: issue(2) },
    );
    expect(row(state)).toEqual(["api", "api > #1", "[web]", "web > #2"]);
  });

  it("opens over All from a new tab", () => {
    const state = apply(tabsOn("new"), {
      kind: "open-in-new-tab",
      issue: issue(1),
    });
    expect(row(state)).toEqual(["[new]", "All > #1"]);
  });
});

describe("closing tabs", () => {
  it("shows the tab to the right of the one closed, or else the one to its left", () => {
    let state = tabsOn(api, web, bugs);
    state = apply(state, { kind: "close", id: idAt(state, 0) });
    expect(row(state)).toEqual(["[web]", "Bugs"]);
    state = apply(
      state,
      { kind: "show", id: idAt(state, 1) },
      { kind: "close", id: idAt(state, 1) },
    );
    expect(row(state)).toEqual(["[web]"]);
  });

  it("keeps the tab shown when another closes", () => {
    let state = tabsOn(api, web, bugs);
    state = apply(state, { kind: "close", id: idAt(state, 2) });
    expect(row(state)).toEqual(["[api]", "web"]);
  });

  it("leaves a new tab once the last closes", () => {
    let state = tabsOn(api);
    state = apply(state, { kind: "close", id: idAt(state, 0) });
    expect(row(state)).toEqual(["[new]"]);
    expect(shownTab(state)?.from).toEqual({ owner: "acme", name: "api" });
  });

  it("closes the other tabs, or those to the right", () => {
    let state = tabsOn(api, web, bugs, all);
    state = apply(state, { kind: "close-others", id: idAt(state, 1) });
    expect(row(state)).toEqual(["[web]"]);
    state = tabsOn(api, web, bugs, all);
    state = apply(state, { kind: "close-right", id: idAt(state, 1) });
    expect(row(state)).toEqual(["[api]", "web"]);
  });

  it("shows the tab whose others closed", () => {
    let state = tabsOn(api, web, bugs);
    state = apply(state, { kind: "close-others", id: idAt(state, 2) });
    expect(row(state)).toEqual(["[Bugs]"]);
    state = tabsOn(api, web, bugs);
    state = apply(
      state,
      { kind: "show", id: idAt(state, 2) },
      { kind: "close-right", id: idAt(state, 0) },
    );
    expect(row(state)).toEqual(["[api]"]);
  });
});

describe("reopening closed tabs", () => {
  it("reopens the tab closed last, with its entry and issue pages, where it stood, then the one before", () => {
    let state = apply(
      tabsOn(api, web, bugs),
      { kind: "navigate", navigation: { kind: "open", issue: issue(1) } },
      { kind: "navigate", navigation: { kind: "open", issue: issue(2) } },
    );
    state = apply(state, { kind: "close", id: idAt(state, 0) });
    state = apply(state, { kind: "close", id: idAt(state, 1) });
    expect(row(state)).toEqual(["[web]"]);
    state = apply(state, { kind: "reopen" });
    expect(row(state)).toEqual(["web", "[Bugs]"]);
    state = apply(state, { kind: "reopen" });
    expect(row(state)).toEqual(["[api > #1 #2]", "web", "Bugs"]);
    expect(apply(state, { kind: "reopen" })).toBe(state);
  });

  it("keeps the place of each issue page it reopens", () => {
    const place = { cursor: "I_9", scrollTop: 120, expanded: ["I_9"] };
    let state = apply(
      tabsOn(api, web),
      { kind: "navigate", navigation: { kind: "open", issue: issue(1) } },
      { kind: "navigate", navigation: { kind: "remember", place } },
    );
    state = apply(
      state,
      { kind: "close", id: idAt(state, 0) },
      {
        kind: "reopen",
      },
    );
    expect(shownTab(state)?.stack[0]?.place).toEqual(place);
  });

  it("reopens the tabs closed together in their order", () => {
    let state = tabsOn(api, web, bugs, all);
    state = apply(state, { kind: "close-others", id: idAt(state, 1) });
    state = apply(
      state,
      { kind: "reopen" },
      { kind: "reopen" },
      {
        kind: "reopen",
      },
    );
    expect(row(state).map((label) => label.replace(/[[\]]/g, ""))).toEqual([
      "api",
      "web",
      "Bugs",
      "All",
    ]);
  });

  it("does not keep new tabs to reopen", () => {
    let state = tabsOn(api, "new");
    state = apply(
      state,
      { kind: "close", id: idAt(state, 1) },
      {
        kind: "reopen",
      },
    );
    expect(row(state)).toEqual(["[api]"]);
  });

  it("reopens a tab over All once its entry is gone", () => {
    let state = tabsOn(api, web);
    state = apply(
      state,
      { kind: "close", id: idAt(state, 1) },
      {
        kind: "follow-entries",
        follow: (entry) =>
          entry.kind === "repository" && entry.repository.name === "web"
            ? undefined
            : entry,
      },
      { kind: "reopen" },
    );
    expect(row(state)).toEqual(["api", "[All]"]);
  });
});

describe("switching tabs", () => {
  it("shows the next or previous tab, around the ends", () => {
    let state = tabsOn(api, web, bugs);
    state = apply(state, { kind: "step", by: 1 });
    expect(row(state)).toEqual(["api", "[web]", "Bugs"]);
    state = apply(state, { kind: "step", by: -1 }, { kind: "step", by: -1 });
    expect(row(state)).toEqual(["api", "web", "[Bugs]"]);
    state = apply(state, { kind: "step", by: 1 });
    expect(row(state)).toEqual(["[api]", "web", "Bugs"]);
  });

  it("navigates only within the tab shown", () => {
    let state = tabsOn(api, web);
    state = apply(
      state,
      { kind: "show", id: idAt(state, 1) },
      { kind: "navigate", navigation: { kind: "open", issue: issue(1) } },
      { kind: "navigate", navigation: { kind: "open", issue: issue(2) } },
      { kind: "navigate", navigation: { kind: "back" } },
    );
    expect(row(state)).toEqual(["api", "[web > #1]"]);
  });
});

describe("dragging tabs", () => {
  it("moves a tab before or after another", () => {
    let state = tabsOn(api, web, bugs, all);
    state = apply(state, {
      kind: "move",
      id: idAt(state, 0),
      target: idAt(state, 2),
      side: "after",
    });
    expect(row(state)).toEqual(["web", "Bugs", "[api]", "All"]);
    state = apply(state, {
      kind: "move",
      id: idAt(state, 3),
      target: idAt(state, 0),
      side: "before",
    });
    expect(row(state)).toEqual(["All", "web", "Bugs", "[api]"]);
  });

  it("keeps the order for the next launch", () => {
    let state = tabsOn(api, web);
    state = apply(state, {
      kind: "move",
      id: idAt(state, 1),
      target: idAt(state, 0),
      side: "before",
    });
    expect(row(restoredTabs(savedAndRestored(state)))).toEqual([
      "web",
      "[api]",
    ]);
  });
});

/** The tabs saved, as the core would restore them with every entry there. */
function savedAndRestored(state: TabState): RestoredTabs {
  const saved = savedTabs(state);
  const entries = state.tabs.flatMap((tab) => (tab.entry ? [tab.entry] : []));
  return {
    shown: saved.shown,
    tabs: saved.tabs.map((tab) => {
      if (tab.kind === "new") return tab;
      const entry = entries.find((one) =>
        one.kind === "view"
          ? tab.entry.kind === "view" && tab.entry.id === one.view.id
          : JSON.stringify(one) === JSON.stringify(tab.entry),
      );
      if (!entry) throw new Error("Unknown entry");
      return { ...tab, entry };
    }),
  };
}

describe("restoring tabs", () => {
  it("brings back each tab's entry and issue pages, and the tab shown, with fresh places", () => {
    const state = restoredTabs({
      tabs: [
        { kind: "entry", entry: api, issues: [issue(1), issue(2)] },
        { kind: "new", from: { owner: "acme", name: "web" } },
        { kind: "entry", entry: bugs, issues: [] },
      ],
      shown: 2,
    });
    expect(row(state)).toEqual(["api > #1 #2", "new", "[Bugs]"]);
    expect(state.tabs[0]?.stack[1]).toEqual({
      issue: issue(2),
      place: { cursor: "I_2", scrollTop: 0, expanded: [] },
    });
    expect(state.tabs[1]?.from).toEqual({ owner: "acme", name: "web" });
  });

  it("saves each tab's entry by its key, and only what names its issue pages", () => {
    const state = apply(
      tabsOn(bugs, "new", api),
      {
        kind: "navigate",
        navigation: {
          kind: "open",
          issue: {
            ...issue(1),
            labels: [],
            author: undefined,
          } as IssueDestination,
        },
      },
      { kind: "show", id: 2 },
    );
    expect(savedTabs(state)).toEqual({
      tabs: [
        {
          kind: "entry",
          entry: { kind: "view", id: "bugs" },
          issues: [issue(1)],
        },
        { kind: "new", from: undefined },
        { kind: "entry", entry: api, issues: [] },
      ],
      shown: 2,
    });
  });

  it("restores one tab on All when there are none", () => {
    expect(row(restoredTabs({ tabs: [], shown: 0 }))).toEqual(["[All]"]);
  });
});

describe("following the sidebar's entries", () => {
  const renamed = repository("api-v2");
  function follow(entry: Scope): Scope | undefined {
    if (entry.kind === "repository" && entry.repository.name === "api")
      return renamed;
    if (entry.kind === "repository" && entry.repository.name === "web")
      return undefined;
    if (entry.kind === "view")
      return { kind: "view", view: { ...entry.view, name: "Open bugs" } };
    return entry;
  }

  it("follows a renamed repository and an edited view, and shows All for an entry gone, keeping issue pages", () => {
    const state = apply(
      tabsOn(api, web, bugs),
      { kind: "show", id: 1 },
      { kind: "navigate", navigation: { kind: "open", issue: issue(1) } },
      { kind: "follow-entries", follow },
    );
    expect(row(state)).toEqual(["api-v2", "[All > #1]", "Open bugs"]);
  });

  it("has a new tab's #12 follow its repository, or name none once it is gone", () => {
    let state = apply(tabsOn(api), { kind: "new" }, { kind: "new" });
    state = {
      ...state,
      tabs: state.tabs.map((tab, index) =>
        index === 2 ? { ...tab, from: { owner: "acme", name: "web" } } : tab,
      ),
    };
    state = apply(state, { kind: "follow-entries", follow });
    expect(state.tabs.map((tab) => tab.from)).toEqual([
      undefined,
      { owner: "acme", name: "api-v2" },
      undefined,
    ]);
  });

  it("changes nothing when every entry stays as it was", () => {
    const state = tabsOn(api, web);
    expect(
      apply(state, { kind: "follow-entries", follow: (entry) => entry }),
    ).toBe(state);
  });
});

describe("naming a tab", () => {
  /** The tracked repositories: `acme/api`, `acme/web` and `acme/docs`. */
  const tracked = ["api", "web", "docs"].map((name) => ({
    owner: "acme",
    name,
  }));

  function tab(entry: Scope | undefined, ...issues: IssueDestination[]): Tab {
    return {
      id: 0,
      entry,
      stack: issues.map((one) => ({
        issue: one,
        place: { cursor: one.id, scrollTop: 0, expanded: [] },
      })),
      from: undefined,
      opener: undefined,
    };
  }

  it("names a repository's tab by its name, and on an issue of its own the issue's number after it", () => {
    expect(tabTitle(tab(api), tracked)).toEqual({
      kind: "repository",
      name: "api",
      issue: undefined,
      tooltip: "acme/api",
    });
    expect(tabTitle(tab(api, issue(1), issue(12)), tracked)).toEqual({
      kind: "repository",
      name: "api",
      issue: { repository: undefined, number: "#12" },
      tooltip: "acme/api › #12 Issue 12",
    });
  });

  it("keeps a repository's name on an issue of another repository, which it names as a chip does", () => {
    const web5 = {
      id: "I_5",
      reference: "acme/web#5",
      title: "Tracked",
      url: "https://github.com/acme/web/issues/5",
    };
    expect(tabTitle(tab(api, web5), tracked)).toEqual({
      kind: "repository",
      name: "api",
      issue: { repository: "web", number: "#5" },
      tooltip: "acme/api › acme/web#5 Tracked",
    });
    const external = {
      id: "I_6",
      reference: "other/repo#6",
      title: "External",
      url: "https://github.com/other/repo/issues/6",
    };
    expect(tabTitle(tab(api, issue(12), external), tracked)).toEqual({
      kind: "repository",
      name: "api",
      issue: { repository: "other/repo", number: "#6" },
      tooltip: "acme/api › other/repo#6 External",
    });
  });

  it("names All's and a view's tab by its name, and on an issue the issue with its repository after it", () => {
    expect(tabTitle(tab(all), tracked)).toEqual({
      kind: "all",
      name: "All",
      issue: undefined,
      tooltip: "All",
    });
    expect(tabTitle(tab(bugs), tracked)).toEqual({
      kind: "view",
      name: "Bugs",
      issue: undefined,
      tooltip: "Bugs",
    });
    const web7 = { id: "I_7", reference: "acme/web#7", title: "Parent" };
    expect(tabTitle(tab(all, web7), tracked)).toEqual({
      kind: "all",
      name: "All",
      issue: { repository: "web", number: "#7" },
      tooltip: "All › acme/web#7 Parent",
    });
    const external = { id: "I_8", reference: "other/repo#8", title: "Bug" };
    expect(tabTitle(tab(bugs, external), tracked)).toEqual({
      kind: "view",
      name: "Bugs",
      issue: { repository: "other/repo", number: "#8" },
      tooltip: "Bugs › other/repo#8 Bug",
    });
  });

  it("names an issue by its number alone where its repository is not known", () => {
    const bare = { id: "I_9", reference: "#9", title: "Bare" };
    expect(tabTitle(tab(bugs, bare), tracked)).toEqual({
      kind: "view",
      name: "Bugs",
      issue: { repository: undefined, number: "#9" },
      tooltip: "Bugs › #9 Bare",
    });
  });

  it("names a new tab New Tab", () => {
    expect(tabTitle(tab(undefined), tracked)).toEqual({
      kind: "new",
      name: "New Tab",
      issue: undefined,
      tooltip: "New Tab",
    });
  });
});
