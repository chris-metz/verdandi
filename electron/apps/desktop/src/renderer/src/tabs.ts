import type {
  RepositoryAddress,
  RestoredTabs,
  SavedTabs,
  TabIssue,
} from "@verdandi/core/contract";
import {
  navigateIssues,
  type IssueDestination,
  type IssueNavigation,
  type IssueVisit,
} from "./issue-navigation";
import { qualifiedReference } from "@verdandi/core/repository-address";
import { issueLocatorOf } from "./go-to-issue";
import { presentScope, type SidebarScope as Scope } from "./scope";

/**
 * A tab over the main area: a sidebar entry's list with the issue pages
 * opened from it one after another, or a new tab, with nothing chosen in
 * it yet.
 */
export interface Tab {
  /** Tells the tab apart from the others while the window is open. */
  id: number;
  /** Its sidebar entry; none for a new tab. */
  entry: Scope | undefined;
  /** The issue pages opened from its list, the one shown last. */
  stack: IssueVisit[];
  /**
   * In a new tab, the repository a bare `#12` names: that of the tab it was
   * opened from, if that showed one.
   */
  from: RepositoryAddress | undefined;
  /** The tab it was opened from in the background, if it was. */
  opener: number | undefined;
}

/** The row of tabs, and the tabs closed while the window is open. */
export interface TabState {
  tabs: Tab[];
  /** The ID of the tab shown. */
  shown: number;
  /** The ID the next tab opened gets. */
  next: number;
  /** The tabs closed, the last closed last, each with where it stood. */
  closed: { tab: Tab; index: number }[];
}

export type TabAction =
  /**
   * Shows an entry chosen in the sidebar in the tab shown, its list in
   * place of what the tab showed, also of the entry's own issue pages.
   */
  | { kind: "choose"; entry: Scope }
  /** Opens an entry chosen in the sidebar in a new tab, in the background. */
  | { kind: "choose-in-new-tab"; entry: Scope }
  /** Opens a new tab at the end of the row, and shows it. */
  | { kind: "new" }
  | { kind: "show"; id: number }
  /** Shows the next or the previous tab, around the ends. */
  | { kind: "step"; by: 1 | -1 }
  | { kind: "close"; id: number }
  /** Closes every tab but this one, and shows it. */
  | { kind: "close-others"; id: number }
  | { kind: "close-right"; id: number }
  /** Reopens the tab closed last where it stood, and shows it. */
  | { kind: "reopen" }
  /** Moves a tab before or after another, as it is dragged there. */
  | { kind: "move"; id: number; target: number; side: "before" | "after" }
  /** Goes to an issue page, or back, within the tab shown. */
  | { kind: "navigate"; navigation: IssueNavigation }
  /**
   * Opens an issue page over the list of the tab shown's entry in a new tab,
   * in the background.
   */
  | { kind: "open-in-new-tab"; issue: IssueDestination }
  /** Shows an issue page over an entry's list in the tab shown. */
  | { kind: "open-here"; entry: Scope; issue: IssueDestination }
  /**
   * Has every tab, open or closed, follow its entry as the sidebar lists it
   * now, or show All in place of one that is gone.
   */
  | { kind: "follow-entries"; follow: (entry: Scope) => Scope | undefined };

/** The tab shown. */
export function shownTab(state: TabState): Tab | undefined {
  return state.tabs.find((tab) => tab.id === state.shown);
}

/** The tabs as the core restored them, each issue page at its top. */
export function restoredTabs({ tabs, shown }: RestoredTabs): TabState {
  const restored = tabs.map((tab, id): Tab =>
    tab.kind === "new"
      ? { id, entry: undefined, stack: [], from: tab.from, opener: undefined }
      : {
          id,
          entry: tab.entry,
          stack: stackOf(tab.issues.map(issueName)),
          from: undefined,
          opener: undefined,
        },
  );
  if (restored.length === 0)
    return {
      tabs: [
        {
          id: 0,
          entry: { kind: "all" },
          stack: [],
          from: undefined,
          opener: undefined,
        },
      ],
      shown: 0,
      next: 1,
      closed: [],
    };
  return {
    tabs: restored,
    shown: restored[Math.min(Math.max(shown, 0), restored.length - 1)]?.id ?? 0,
    next: restored.length,
    closed: [],
  };
}

/** The tabs as the core keeps them for the next launch. */
export function savedTabs(state: TabState): SavedTabs {
  return {
    tabs: state.tabs.map((tab) =>
      tab.entry === undefined
        ? { kind: "new", from: tab.from }
        : {
            kind: "entry",
            entry:
              tab.entry.kind === "view"
                ? { kind: "view", id: tab.entry.view.id }
                : tab.entry,
            issues: tab.stack.map(({ issue }) => issueName(issue)),
          },
    ),
    shown: Math.max(
      state.tabs.findIndex((tab) => tab.id === state.shown),
      0,
    ),
  };
}

/**
 * What names an issue page, as the list it was opened from named it,
 * without what else the list knew of it.
 */
function issueName({ id, reference, title, url }: TabIssue): IssueDestination {
  return { id, reference, title, ...(url === undefined ? {} : { url }) };
}

/** The issue pages opened one after another, each at its top. */
function stackOf(issues: readonly IssueDestination[]): IssueVisit[] {
  return issues.reduce<IssueVisit[]>(
    (stack, issue) => navigateIssues(stack, { kind: "open", issue }),
    [],
  );
}

export function updateTabs(state: TabState, action: TabAction): TabState {
  const shown = shownTab(state);
  switch (action.kind) {
    case "choose":
      return updateShown(state, (tab) => ({
        ...tab,
        entry: action.entry,
        stack: [],
        from: undefined,
      }));
    case "choose-in-new-tab":
      return openInBackground(state, action.entry, []);
    case "new": {
      const tab = newTab(state.next, shown && repositoryOf(shown));
      return {
        ...state,
        tabs: [...state.tabs, tab],
        shown: tab.id,
        next: state.next + 1,
      };
    }
    case "show":
      return state.tabs.some((tab) => tab.id === action.id)
        ? { ...state, shown: action.id }
        : state;
    case "step": {
      const index = state.tabs.findIndex((tab) => tab.id === state.shown);
      const count = state.tabs.length;
      const next = state.tabs[(index + action.by + count) % count];
      return next ? { ...state, shown: next.id } : state;
    }
    case "close":
      return close(state, [action.id]);
    case "close-others":
      return close(
        { ...state, shown: action.id },
        state.tabs.flatMap((tab) => (tab.id === action.id ? [] : [tab.id])),
      );
    case "close-right": {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index < 0) return state;
      const right = state.tabs.slice(index + 1).map((tab) => tab.id);
      return close(
        right.includes(state.shown) ? { ...state, shown: action.id } : state,
        right,
      );
    }
    case "reopen": {
      const last = state.closed.at(-1);
      if (!last) return state;
      const tabs = [...state.tabs];
      tabs.splice(Math.min(last.index, tabs.length), 0, last.tab);
      return {
        ...state,
        tabs,
        shown: last.tab.id,
        closed: state.closed.slice(0, -1),
      };
    }
    case "move": {
      const moved = state.tabs.find((tab) => tab.id === action.id);
      if (!moved || action.id === action.target) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      const target = tabs.findIndex((tab) => tab.id === action.target);
      if (target < 0) return state;
      tabs.splice(target + (action.side === "after" ? 1 : 0), 0, moved);
      return { ...state, tabs };
    }
    case "navigate":
      return updateShown(state, (tab) =>
        tab.entry
          ? { ...tab, stack: navigateIssues(tab.stack, action.navigation) }
          : tab,
      );
    case "open-in-new-tab":
      return openInBackground(state, shown?.entry ?? { kind: "all" }, [
        action.issue,
      ]);
    case "open-here":
      return updateShown(state, (tab) => ({
        ...tab,
        entry: action.entry,
        stack: navigateIssues([], { kind: "open", issue: action.issue }),
        from: undefined,
      }));
    case "follow-entries": {
      const follow = (tab: Tab) => followEntry(tab, action.follow);
      const tabs = state.tabs.map(follow);
      const closed = state.closed.map((closed) => {
        const tab = follow(closed.tab);
        return tab === closed.tab ? closed : { ...closed, tab };
      });
      return tabs.every((tab, index) => tab === state.tabs[index]) &&
        closed.every((one, index) => one === state.closed[index])
        ? state
        : { ...state, tabs, closed };
    }
  }
}

function newTab(id: number, from: RepositoryAddress | undefined): Tab {
  return { id, entry: undefined, stack: [], from, opener: undefined };
}

/** The repository a tab shows, or that a bare `#12` names in a new tab. */
function repositoryOf(tab: Tab): RepositoryAddress | undefined {
  if (!tab.entry) return tab.from;
  return tab.entry.kind === "repository" ? tab.entry.repository : undefined;
}

function updateShown(state: TabState, update: (tab: Tab) => Tab): TabState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === state.shown ? update(tab) : tab)),
  };
}

/**
 * Opens a tab on an entry with these issue pages in the background, as a
 * browser does: after the tab shown, and the tabs opened from it already.
 */
function openInBackground(
  state: TabState,
  entry: Scope,
  issues: IssueDestination[],
): TabState {
  const tab: Tab = {
    id: state.next,
    entry,
    stack: stackOf(issues),
    from: undefined,
    opener: state.shown,
  };
  let index = state.tabs.findIndex((each) => each.id === state.shown);
  while (state.tabs[index + 1]?.opener === state.shown) index++;
  const tabs = [...state.tabs];
  tabs.splice(index + 1, 0, tab);
  return { ...state, tabs, next: state.next + 1 };
}

/**
 * Closes tabs one after another, each kept to reopen where it stood, but a
 * new tab. The tab shown, if closed, gives way to the one to its right, or
 * else to its left; the last one closed leaves a new tab.
 */
function close(state: TabState, ids: readonly number[]): TabState {
  let { tabs, shown, next } = state;
  const closed = [...state.closed];
  for (const id of ids) {
    const index = tabs.findIndex((tab) => tab.id === id);
    const tab = tabs[index];
    if (!tab) continue;
    if (tab.entry) closed.push({ tab, index });
    tabs = tabs.filter((other) => other.id !== id);
    if (tabs.length === 0) {
      const replacement = newTab(next++, repositoryOf(tab));
      tabs = [replacement];
      shown = replacement.id;
    } else if (id === shown) {
      const neighbour = tabs[index] ?? tabs[index - 1];
      if (neighbour) shown = neighbour.id;
    }
  }
  return { ...state, tabs, shown, next, closed };
}

/**
 * A tab with its entry as the sidebar lists it now, or All once it is gone,
 * and a new tab's `#12` following its repository; the same tab if neither
 * changed.
 */
function followEntry(
  tab: Tab,
  follow: (entry: Scope) => Scope | undefined,
): Tab {
  if (tab.entry) {
    const entry = follow(tab.entry) ?? { kind: "all" };
    return entry === tab.entry ? tab : { ...tab, entry };
  }
  if (!tab.from) return tab;
  const followed = follow({ kind: "repository", repository: tab.from });
  const from =
    followed?.kind === "repository" ? followed.repository : undefined;
  return from === tab.from ? tab : { ...tab, from };
}

/** How the tab bar names a tab, and its tooltip. */
export type TabTitle =
  | { kind: "issue"; number: string; title: string; tooltip: string }
  | { kind: "list" | "new"; title: string; tooltip: string };

/**
 * An issue page's tab shows its number and title, its tooltip its
 * repository too; a list's tab its entry's name, and a new tab New Tab.
 */
export function tabTitle(tab: Tab): TabTitle {
  const issue = tab.stack.at(-1)?.issue;
  if (issue) {
    const located = issueLocatorOf(issue, tab.entry);
    const number = located ? `#${String(located.number)}` : issue.reference;
    const qualified =
      located?.repository === undefined
        ? number
        : qualifiedReference(located.repository, located.number);
    return {
      kind: "issue",
      number,
      title: issue.title,
      tooltip: `${qualified} ${issue.title}`,
    };
  }
  if (tab.entry) {
    const { label } = presentScope(tab.entry);
    return { kind: "list", title: label, tooltip: label };
  }
  return { kind: "new", title: "New Tab", tooltip: "New Tab" };
}
