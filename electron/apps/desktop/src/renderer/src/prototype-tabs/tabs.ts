/**
 * PROTOTYPE (tabs), throwaway: tabs over the main area, browser-like. Each
 * tab is a sidebar entry's list with the issue pages opened from it, or a
 * new tab's page. The sidebar shows and changes the active tab's entry.
 */
import type { RepositoryAddress } from "@verdandi/core/contract";
import {
  navigateIssues,
  type IssueDestination,
  type IssueNavigation,
  type IssueVisit,
} from "../issue-navigation";
import type { SidebarScope as Scope } from "../scope";

export interface PrototypeTab {
  id: number;
  scope: Scope | undefined;
  stack: IssueVisit[];
  /** Opened with + or ⌘T, and nothing chosen in it yet. */
  isNew: boolean;
  /** The repository a bare `#12` names on the new tab's page. */
  from?: RepositoryAddress | undefined;
  /** The tab it was opened from with Open in New Tab. */
  openerId?: number | undefined;
}

export interface TabsState {
  tabs: PrototypeTab[];
  activeId: number;
  nextId: number;
}

export type TabsAction =
  | { kind: "new"; from?: RepositoryAddress | undefined }
  | { kind: "close"; id: number }
  | { kind: "activate"; id: number }
  | { kind: "cycle"; step: 1 | -1 }
  | {
      kind: "set-scope";
      update:
        Scope | undefined | ((scope: Scope | undefined) => Scope | undefined);
    }
  | { kind: "navigate"; action: IssueNavigation }
  | { kind: "open-in-tab"; scope: Scope; issue: IssueDestination }
  | { kind: "open-in-new-tab"; scope: Scope; issue: IssueDestination };

export function initialTabs(): TabsState {
  return {
    tabs: [{ id: 0, scope: undefined, stack: [], isNew: false }],
    activeId: 0,
    nextId: 1,
  };
}

export function activeTab(state: TabsState): PrototypeTab {
  return (
    state.tabs.find((tab) => tab.id === state.activeId) ??
    (state.tabs[0] as PrototypeTab)
  );
}

function updateActive(
  state: TabsState,
  update: (tab: PrototypeTab) => PrototypeTab,
): TabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === state.activeId ? update(tab) : tab,
    ),
  };
}

function newTab(id: number, from?: RepositoryAddress): PrototypeTab {
  return { id, scope: undefined, stack: [], isNew: true, from };
}

export function reduceTabs(state: TabsState, action: TabsAction): TabsState {
  switch (action.kind) {
    case "new": {
      const tab = newTab(state.nextId, action.from);
      const index = state.tabs.findIndex((each) => each.id === state.activeId);
      const tabs = [...state.tabs];
      tabs.splice(index + 1, 0, tab);
      return { tabs, activeId: tab.id, nextId: state.nextId + 1 };
    }
    case "close": {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      // The last tab closed leaves a new tab's page, not an empty window.
      if (tabs.length === 0) {
        const tab = newTab(state.nextId);
        return { tabs: [tab], activeId: tab.id, nextId: state.nextId + 1 };
      }
      const activeId =
        action.id === state.activeId
          ? (tabs[Math.min(index, tabs.length - 1)] as PrototypeTab).id
          : state.activeId;
      return { ...state, tabs, activeId };
    }
    case "activate":
      return { ...state, activeId: action.id };
    case "cycle": {
      const index = state.tabs.findIndex((tab) => tab.id === state.activeId);
      const next =
        state.tabs[
          (index + action.step + state.tabs.length) % state.tabs.length
        ];
      return next ? { ...state, activeId: next.id } : state;
    }
    case "set-scope":
      return updateActive(state, (tab) => {
        const scope =
          typeof action.update === "function"
            ? action.update(tab.scope)
            : action.update;
        return scope === tab.scope ? tab : { ...tab, scope };
      });
    case "navigate":
      return updateActive(state, (tab) => ({
        ...tab,
        stack: navigateIssues(tab.stack, action.action),
      }));
    case "open-in-new-tab": {
      // In the background, after the tabs already opened from this one, as
      // browsers do.
      const tab: PrototypeTab = {
        id: state.nextId,
        scope: action.scope,
        stack: navigateIssues([], { kind: "open", issue: action.issue }),
        isNew: false,
        openerId: state.activeId,
      };
      let index = state.tabs.findIndex((each) => each.id === state.activeId);
      while (state.tabs[index + 1]?.openerId === state.activeId) index += 1;
      const tabs = [...state.tabs];
      tabs.splice(index + 1, 0, tab);
      return { ...state, tabs, nextId: state.nextId + 1 };
    }
    case "open-in-tab":
      return updateActive(state, (tab) => ({
        ...tab,
        scope: action.scope,
        stack: navigateIssues([], { kind: "open", issue: action.issue }),
      }));
  }
}
