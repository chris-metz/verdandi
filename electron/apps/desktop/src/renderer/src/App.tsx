import type {
  IssueList,
  RecentIssue,
  RepositoryAddress,
  RestoredTabs,
  SavedView,
  SidebarEntryKey,
  SidebarDestination,
  Screen,
  TrackedRepository,
} from "@verdandi/core/contract";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { useConfig } from "./config";
import { openedIssue, recentIssueOf, tabEntryOf } from "./go-to-issue";
import { GoToIssueDialog } from "./GoToIssueDialog";
import type { IssueDestination, IssueNavigation } from "./issue-navigation";
import { MainArea } from "./MainArea";
import { NewTabPane } from "./NewTabPane";
import { Notices } from "./Notices";
import { OpenInNewTab } from "./open-in-new-tab";
import {
  commandForWindowKey,
  shortcutModifier,
  tabStepForKey,
  type Pane,
} from "./pane-navigation";
import { RepositoryPicker } from "./RepositoryPicker";
import { RemoveEntryDialog, type RemovableEntry } from "./RemoveEntryDialog";
import { copyPlace, forgetPlace, movePlace } from "./list-places";
import { problemText } from "./problem-text";
import { unavailableText } from "./repository-picker";
import {
  repositoryLabel,
  sameScope,
  scopeLabel,
  type SidebarScope as Scope,
} from "./scope";
import { SettingsDialog } from "./SettingsDialog";
import { SetupDialog, useSetup } from "./SetupDialog";
import { Sidebar, useSidebar } from "./Sidebar";
import { SidebarButton } from "./SidebarButton";
import { useSidebarHidden } from "./sidebar-hidden";
import { settingsProblem } from "./sidebar-warnings";
import { entryOrder, followSelection } from "./sidebar-entries";
import { TabBar } from "./TabBar";
import {
  restoredTabs,
  savedTabs,
  shownTab,
  updateTabs,
  type TabAction,
  type TabState,
} from "./tabs";
import { ViewDialog } from "./ViewDialog";
import type { ViewDialogPurpose } from "./view-dialog";

/** Shortcuts use ⌘ on macOS and Ctrl elsewhere. */
const modifier = shortcutModifier(window.desktop.platform);

/** The View menu's shortcut that hides and shows the sidebar. */
const sidebarShortcut = window.desktop.platform === "darwin" ? "⌃⌘S" : "Ctrl+B";

/** The mark on the pane that has the keyboard: an accent edge on top. */
const focusedPaneMark = "shadow-[inset_0_2px_0_var(--selection-edge)]";

/** The tabs, once restored at launch. */
function reduceTabs(
  state: TabState | undefined,
  action: TabAction | { kind: "restore"; tabs: RestoredTabs },
): TabState | undefined {
  if (action.kind === "restore") return state ?? restoredTabs(action.tabs);
  return state && updateTabs(state, action);
}

/**
 * The window: the sidebar and the main area, which have the keyboard in turn.
 * The pane that has it follows the DOM focus, and survives the main area's
 * list being replaced when another entry is selected. The main area holds
 * tabs, restored as they were at launch, and the sidebar shows into the tab
 * shown, which has the keyboard once shown. What is on screen is read again
 * with `r`, and when it is old as the window regains focus. When GitHub is
 * read as another account, every tab stays, read anew as it shows. A
 * repository renamed or transferred stays in its tabs under its new name,
 * with their issue pages and places in its list, and a tab whose entry is
 * removed shows All, its issue pages kept. Every issue opened, whichever
 * way, becomes the first recent issue. While the setup blocker is up,
 * everything behind it stays as it was but is inert; once it goes, the pane
 * that had the keyboard has it again. The user can hide the sidebar, leaving
 * the window to the main area, which then keeps the keyboard.
 */
export function App() {
  const setup = useSetup();
  const blocked = setup?.status === "blocked";
  const sidebar = useSidebar();
  const items = useMemo(() => entryOrder(sidebar), [sidebar]);
  const entries = useMemo(() => items.map((item) => item.scope), [items]);
  const tracked = useMemo(
    () =>
      sidebar?.status === "read"
        ? sidebar.repositories.map(({ repository }) => repository)
        : [],
    [sidebar],
  );
  const [tabs, dispatch] = useReducer(reduceTabs, undefined);
  const tab = tabs && shownTab(tabs);
  /** The entry of the tab shown; none for a new tab. */
  const selected = tab?.entry;
  // The issue pages opened from the tab's list, the last on top.
  const stack = useMemo(() => tab?.stack ?? [], [tab]);
  const shownIssueId = stack.at(-1)?.issue.id;
  const screen = useMemo((): Screen | undefined => {
    if (shownIssueId !== undefined) {
      return { kind: "issue", issueId: shownIssueId };
    }
    if (selected?.kind === "view") {
      return { kind: "view", viewId: selected.view.id };
    }
    return selected && { kind: "list", scope: selected };
  }, [selected, shownIssueId]);
  const [focusedPane, setFocusedPane] = useState<Pane>("sidebar");
  const sidebarHidden = useSidebarHidden();
  /** The pane that has the keyboard: the main area while the sidebar is hidden. */
  const focused = sidebarHidden ? "main" : focusedPane;
  const shortcutsShown = useShortcutsShown();
  const [settingsError, setSettingsError] = useState<string>();
  const sidebarPane = useRef<HTMLElement>(null);
  const mainPane = useRef<HTMLElement>(null);
  const [picking, setPicking] = useState(false);
  /** The sidebar entry whose removal is being confirmed. */
  const [removing, setRemoving] = useState<RemovableEntry>();
  /**
   * The renames the core announced, by the old `owner/name` in lower case,
   * to follow a tab's entry that does not know its repository's ID.
   */
  const renamed = useRef(new Map<string, RepositoryAddress>());
  /** The view dialog, open for a new view, or to edit or duplicate a view. */
  const [viewDialog, setViewDialog] = useState<ViewDialogPurpose>();
  const config = useConfig();
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Whether the Go to Issue dialog is open over the tab shown. */
  const [goToIssueOpen, setGoToIssueOpen] = useState(false);
  const dialogOpen =
    picking ||
    removing !== undefined ||
    viewDialog !== undefined ||
    settingsOpen ||
    goToIssueOpen;
  const login =
    setup?.status === "ready" && setup.account.status === "known"
      ? setup.account.account.login
      : undefined;

  async function reorder(
    entry: SidebarEntryKey,
    destination: SidebarDestination,
  ) {
    if (sidebar?.status !== "read" || sidebar.settings.status !== "writable")
      return;
    try {
      const result = await window.verdandi.reorderSidebar(entry, destination);
      setSettingsError(result.ok ? undefined : result.message);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Opens the repository picker, unless the setup blocker is up. */
  function openPicker() {
    if (!blocked) setPicking(true);
  }

  /** Gives the pane that had the keyboard it again, as a dialog closes. */
  function refocusPane() {
    focusPane((focused === "sidebar" ? sidebarPane : mainPane).current);
  }

  /** Closes the picker, giving the pane that had the keyboard it again. */
  function closePicker() {
    setPicking(false);
    refocusPane();
  }

  /** Asks to confirm removing a repository or view, if settings are writable. */
  function confirmRemoval(entry: RemovableEntry) {
    if (
      !blocked &&
      sidebar?.status === "read" &&
      sidebar.settings.status === "writable"
    )
      setRemoving(entry);
  }

  function confirmRepositoryRemoval(repository: TrackedRepository) {
    confirmRemoval({ kind: "repository", repository });
  }

  function confirmViewRemoval(view: SavedView) {
    confirmRemoval({ kind: "view", view });
  }

  /**
   * **Track the new owner/name**: tracks the repository that took over a
   * tracked repository's name in its place, saying why when it cannot.
   */
  async function trackNewRepository(repository: TrackedRepository) {
    if (
      blocked ||
      sidebar?.status !== "read" ||
      sidebar.settings.status !== "writable"
    )
      return;
    const label = repositoryLabel(repository);
    try {
      const result = await window.verdandi.replaceRepository(repository);
      const why =
        result.status === "failed"
          ? problemText(result.problem, login).text
          : result.status === "unavailable" && result.repository.unavailable
            ? unavailableText(result.repository.unavailable).text
            : undefined;
      setSettingsError(
        why === undefined
          ? undefined
          : `The new ${label} could not be tracked: ${why}`,
      );
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Opens a view's dialog from a notice, as the sidebar has the view now. */
  function openNoticeView(view: SavedView) {
    const current =
      sidebar?.status === "read"
        ? sidebar.views.find((entry) => entry.view.id === view.id)?.view
        : undefined;
    if (current) openViewDialog({ kind: "edit", view: current });
  }

  /** Opens the view dialog, unless the setup blocker is up. */
  function openViewDialog(purpose: ViewDialogPurpose) {
    if (!blocked && sidebar?.status === "read") setViewDialog(purpose);
  }

  function editView(view: SavedView) {
    openViewDialog({ kind: "edit", view });
  }

  function duplicateView(view: SavedView) {
    openViewDialog({ kind: "duplicate", view });
  }

  /** Closes the view dialog, giving the pane that had the keyboard it again. */
  function closeViewDialog() {
    setViewDialog(undefined);
    refocusPane();
  }

  // Settings… in the menu opens the settings dialog, unless another dialog
  // or the setup blocker is up.
  useEffect(
    () =>
      window.desktop.onOpenSettings(() => {
        if (!blocked && !dialogOpen) setSettingsOpen(true);
      }),
    [blocked, dialogOpen],
  );

  /** Closes the settings, giving the pane that had the keyboard it again. */
  function closeSettings() {
    setSettingsOpen(false);
    refocusPane();
  }

  /** Opens the Go to Issue dialog, unless the setup blocker is up. */
  function openGoToIssue() {
    if (!blocked) setGoToIssueOpen(true);
  }

  /** Shows a view just saved, with its list in front of any issue page. */
  function showSaved(view: SavedView) {
    setViewDialog(undefined);
    select({ kind: "view", view });
    focusPane(mainPane.current);
  }

  /**
   * Shows an entry chosen in the sidebar in the tab shown, its list in place
   * of what the tab showed.
   */
  function select(scope: Scope) {
    dispatch({ kind: "choose", entry: scope });
  }

  /** Goes to an issue page, or back, within the tab shown. */
  function navigate(navigation: IssueNavigation) {
    if (navigation.kind === "open") recordRecent(navigation.issue, selected);
    dispatch({ kind: "navigate", navigation });
  }

  /**
   * Opens an issue chosen in Go to Issue: over the tab's list, or in a new
   * tab over its repository's list when the repository is tracked, and
   * over All otherwise.
   */
  function goTo(issue: RecentIssue) {
    void window.verdandi.recordRecentIssue(issue).catch(() => undefined);
    if (selected) {
      dispatch({
        kind: "navigate",
        navigation: { kind: "open", issue: openedIssue(issue, selected) },
      });
      return;
    }
    const entry = tabEntryOf(issue.repository, tracked);
    dispatch({ kind: "open-here", entry, issue: openedIssue(issue, entry) });
  }

  // Open in New Tab, the same function for every pane all along, as rows
  // show again only when it changes.
  const latest = useRef({ tabs, selected });
  useLayoutEffect(() => {
    latest.current = { tabs, selected };
  });
  const openInNewTab = useCallback((issue: IssueDestination) => {
    const { tabs, selected } = latest.current;
    if (!tabs) return;
    recordRecent(issue, selected);
    // The new tab starts where the tab shown is in the list, and gets the
    // next ID.
    copyPlace(tabs.shown, tabs.next, selected ?? { kind: "all" });
    dispatch({ kind: "open-in-new-tab", issue });
  }, []);

  // The tabs as they were at launch; a tab reads its screen once shown.
  useEffect(() => {
    let current = true;
    window.verdandi.getTabs().then(
      (restored) => {
        if (current) dispatch({ kind: "restore", tabs: restored });
      },
      () => {
        if (current)
          dispatch({ kind: "restore", tabs: { tabs: [], shown: 0 } });
      },
    );
    return () => {
      current = false;
    };
  }, []);

  // Kept for the next launch whenever a tab, its entry or its issue pages
  // change, but not as places within them do.
  const saved = useRef<string>(undefined);
  useEffect(() => {
    if (!tabs) return;
    const tabsToSave = savedTabs(tabs);
    const json = JSON.stringify(tabsToSave);
    if (json === saved.current) return;
    saved.current = json;
    void window.verdandi.saveTabs(tabsToSave).catch(() => undefined);
  }, [tabs]);

  // The tab shown has the keyboard, once another is shown.
  const shownBefore = useRef(tabs?.shown);
  useEffect(() => {
    const before = shownBefore.current;
    shownBefore.current = tabs?.shown;
    if (before !== undefined && before !== tabs?.shown)
      focusPane(mainPane.current);
  }, [tabs?.shown]);

  // New Tab, Close Tab and Reopen Closed Tab in the menu, with their
  // shortcuts, which never reach the page.
  useEffect(
    () =>
      window.desktop.onTabCommand((command) => {
        if (blocked || dialogOpen || !tabs) return;
        switch (command) {
          case "new-tab":
            dispatch({ kind: "new" });
            break;
          case "close-tab":
            dispatch({ kind: "close", id: tabs.shown });
            break;
          case "reopen-closed-tab":
            dispatch({ kind: "reopen" });
            break;
        }
      }),
    [blocked, dialogOpen, tabs],
  );

  // On first launch, without a settings file, the picker opens once the
  // setup is ready; with a file, even an empty one, it never opens on its own.
  const [firstLaunchChecked, setFirstLaunchChecked] = useState(false);
  if (
    !firstLaunchChecked &&
    setup?.status === "ready" &&
    sidebar?.status === "read"
  ) {
    setFirstLaunchChecked(true);
    if (sidebar.firstLaunch) setPicking(true);
  }

  // The sidebar has the keyboard at launch. Hidden, it cannot take it, and
  // the main area's tab takes it as it shows.
  useEffect(() => {
    focusPane(sidebarPane.current);
  }, []);

  // Hidden, the sidebar gives the keyboard to the main area; shown again, it
  // leaves the keyboard where it is. This runs before the browser takes the
  // keyboard from the hidden sidebar by itself.
  useLayoutEffect(() => {
    if (sidebarHidden && sidebarPane.current?.contains(document.activeElement))
      focusPane(mainPane.current);
  }, [sidebarHidden]);

  // Back from the setup blocker, the pane that had the keyboard has it again.
  const blockedBefore = useRef(blocked);
  useEffect(() => {
    const wasBlocked = blockedBefore.current;
    blockedBefore.current = blocked;
    if (wasBlocked && !blocked) {
      focusPane((focused === "sidebar" ? sidebarPane : mainPane).current);
    }
  }, [blocked, focused]);

  // The core pushes a scope's list only in the state it shows it in, so the
  // last list pushed tells which one `s` switches from. It tells which
  // issues the Go to issue dialog opens without asking GitHub too, on the
  // issue pages that replace the list as well.
  const lists = useRef(new Map<string, IssueList>());
  useEffect(
    () =>
      window.verdandi.on("listChanged", (list) => {
        lists.current.set(scopeLabel(list.scope), list);
      }),
    [],
  );

  /** The list last pushed for a scope, in the state the core shows it in. */
  function pushedList(scope: Scope): IssueList | undefined {
    return lists.current.get(scopeLabel(scope));
  }

  useEffect(
    () =>
      window.verdandi.on("notice", (notice) => {
        // The sidebar follows with the new names; places move ahead of it.
        if (notice.kind === "repositories-renamed") {
          for (const { from, to } of notice.renamed) {
            renamed.current.set(repositoryLabel(from).toLowerCase(), to);
            movePlace(
              { kind: "repository", repository: from },
              { kind: "repository", repository: to },
            );
          }
        }
      }),
    [],
  );

  // A removal, a hand edit or Reset can remove an entry or rename a view,
  // and GitHub can rename or transfer a repository, which stays in its tabs
  // with their issue pages.
  useEffect(
    () =>
      window.verdandi.on("sidebarChanged", (changed) => {
        if (changed.status !== "read") return;
        const scopes = entryOrder(changed).map((item) => item.scope);
        /** An entry as the sidebar lists it now, or none once it is gone. */
        function follow(entry: Scope): Scope | undefined {
          const current = followSelection(entry, scopes, renamed.current);
          if (current?.kind === "view" && entry.kind === "view")
            return current.view.name !== entry.view.name ||
              current.view.query !== entry.view.query
              ? current
              : entry;
          return current && sameScope(current, entry) ? entry : current;
        }
        const { tabs } = latest.current;
        for (const { entry } of [
          ...(tabs?.tabs ?? []),
          ...(tabs?.closed.map((closed) => closed.tab) ?? []),
        ]) {
          const current = entry && follow(entry);
          if (entry && current?.kind === "repository" && current !== entry)
            movePlace(entry, current);
        }
        dispatch({ kind: "follow-entries", follow });
      }),
    [],
  );

  // Back in the window, what is on screen is read again if it is old.
  useEffect(() => {
    function revalidate() {
      void window.verdandi.revalidate(screen);
    }
    window.addEventListener("focus", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
    };
  }, [screen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A key the focused pane has handled is not the window's, and none is
      // while the setup blocker or the picker is up.
      if (event.defaultPrevented || blocked || dialogOpen) return;
      // The tabs switch wherever the keyboard is, also in a new tab's field.
      const step = tabStepForKey(event, window.desktop.platform);
      if (step) {
        event.preventDefault();
        dispatch({ kind: "step", by: step });
        return;
      }
      const field =
        event.target instanceof Element
          ? event.target.closest(
              "button, input, textarea, select, [contenteditable=true], [role=menu]",
            )
          : null;
      // A new tab's field leaves Tab, and ⌘/Ctrl+1…9 for the sidebar's
      // entries, to the window, as a list does.
      if (
        field &&
        !(
          field.hasAttribute("data-pane-focus") &&
          (event.key === "Tab" || modifier.isHeld(event))
        )
      )
        return;
      const command = commandForWindowKey(event, {
        focused,
        entries,
        selected,
        modifier,
        sidebarHidden,
      });
      if (!command) return;
      event.preventDefault();
      switch (command.kind) {
        case "focus":
          focusPane(
            (command.pane === "sidebar" ? sidebarPane : mainPane).current,
          );
          break;
        case "select":
          select(command.scope);
          break;
        case "reorder":
          void reorder(command.entry, command.destination);
          break;
        case "refresh":
          void window.verdandi.refresh(screen);
          break;
        case "switch-state":
          // Only while the list shows, not an issue page opened from it.
          if (screen?.kind === "list") {
            const shown = pushedList(screen.scope)?.state;
            void window.verdandi.switchState(
              screen.scope,
              shown === "closed" ? "open" : "closed",
            );
          }
          break;
        case "add-repository":
          openPicker();
          break;
        case "go-to-issue":
          openGoToIssue();
          break;
        case "remove-repository":
          confirmRepositoryRemoval(command.repository);
          break;
        case "new-view":
          openViewDialog({ kind: "new" });
          break;
        case "edit-view":
          editView(command.view);
          break;
        case "duplicate-view":
          duplicateView(command.view);
          break;
        case "remove-view":
          confirmViewRemoval(command.view);
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  return (
    <OpenInNewTab.Provider value={openInNewTab}>
      <div className="flex h-screen text-sm" inert={blocked}>
        <aside
          ref={sidebarPane}
          tabIndex={-1}
          onFocus={() => {
            setFocusedPane("sidebar");
          }}
          className={cn(
            "w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground outline-none",
            sidebarHidden ? "hidden" : "flex",
            focused === "sidebar" && focusedPaneMark,
          )}
        >
          <Sidebar
            sidebar={sidebar}
            setup={setup}
            items={items}
            selected={selected}
            onSelect={select}
            onSelectInNewTab={(entry) => {
              dispatch({ kind: "choose-in-new-tab", entry });
            }}
            onReorder={reorder}
            onAddRepository={openPicker}
            onRemoveRepository={confirmRepositoryRemoval}
            onTrackNewRepository={(repository) => {
              void trackNewRepository(repository);
            }}
            onNewView={() => {
              openViewDialog({ kind: "new" });
            }}
            onEditView={editView}
            onDuplicateView={duplicateView}
            onRemoveView={confirmViewRemoval}
            settingsError={settingsError}
            focused={focused === "sidebar"}
            shortcutsShown={shortcutsShown}
            modifier={modifier}
          />
        </aside>
        <main
          ref={mainPane}
          tabIndex={-1}
          onFocus={(event) => {
            setFocusedPane("main");
            // A click beside the list, e.g. on a tab, still gives the list
            // the keyboard. Only after the press: moving the focus during it
            // makes Chromium drop the press, and a tab could not be dragged.
            if (event.target === event.currentTarget) {
              const main = event.currentTarget;
              setTimeout(() => {
                if (document.activeElement === main) focusPane(main);
              });
            }
          }}
          className={cn(
            "flex min-w-0 flex-1 flex-col outline-none",
            focused === "main" && focusedPaneMark,
          )}
        >
          {tabs && (
            <TabBar
              sidebarButton={
                <SidebarButton
                  hidden={sidebarHidden}
                  shortcut={sidebarShortcut}
                  onToggle={() => {
                    window.desktop.setSidebarHidden(!sidebarHidden);
                  }}
                  sidebar={sidebar}
                  config={config}
                  settingsError={settingsError}
                  setup={setup}
                />
              }
              tabs={tabs.tabs}
              tracked={tracked}
              shown={tabs.shown}
              newTabShortcut={modifier.label("T")}
              onShow={(id) => {
                dispatch({ kind: "show", id });
              }}
              onClose={(id) => {
                dispatch({ kind: "close", id });
              }}
              onCloseOthers={(id) => {
                dispatch({ kind: "close-others", id });
              }}
              onCloseRight={(id) => {
                dispatch({ kind: "close-right", id });
              }}
              onMove={(id, target, side) => {
                dispatch({ kind: "move", id, target, side });
              }}
              onNew={() => {
                dispatch({ kind: "new" });
              }}
            />
          )}
          {tab?.entry ? (
            // Another tab or scope starts from a fresh list, never the
            // previous one's.
            <MainArea
              key={`${String(tab.id)}:${scopeLabel(tab.entry)}`}
              tab={tab.id}
              scope={tab.entry}
              repositories={
                sidebar?.status === "read" ? sidebar.repositories : []
              }
              onSelectRepository={(repository) => {
                select({ kind: "repository", repository });
              }}
              onRemoveRepository={
                sidebar?.status === "read" &&
                sidebar.settings.status === "writable"
                  ? confirmRepositoryRemoval
                  : undefined
              }
              onTrackNewRepository={(repository) => {
                void trackNewRepository(repository);
              }}
              onEditView={() => {
                if (tab.entry?.kind === "view") editView(tab.entry.view);
              }}
              onGoToIssue={openGoToIssue}
              stack={stack}
              login={login}
              onNavigate={navigate}
              hasKeyboard={focused === "main" && !dialogOpen && !blocked}
            />
          ) : (
            tab && (
              <NewTabPane
                key={tab.id}
                from={tab.from}
                login={login}
                hasKeyboard={focused === "main" && !dialogOpen && !blocked}
                onChoose={goTo}
              />
            )
          )}
        </main>
      </div>
      {picking && (
        <RepositoryPicker
          firstLaunch={sidebar?.status === "read" && sidebar.firstLaunch}
          settingsProblem={settingsProblem(sidebar)}
          login={login}
          onClose={closePicker}
        />
      )}
      {removing && (
        <RemoveEntryDialog
          entry={removing}
          returnFocus={sidebarHidden ? mainPane : sidebarPane}
          onRemove={() =>
            removing.kind === "repository"
              ? window.verdandi.removeRepository(removing.repository)
              : window.verdandi.removeView(removing.view.id)
          }
          // Its tabs show All as the sidebar drops it.
          onRemoved={() => {
            forgetPlace(removing);
            setRemoving(undefined);
          }}
          onClose={() => {
            setRemoving(undefined);
          }}
        />
      )}
      {viewDialog && (
        <ViewDialog
          purpose={viewDialog}
          tracked={tracked}
          removable={
            sidebar?.status === "read" && sidebar.settings.status === "writable"
          }
          modifier={modifier}
          onSaved={showSaved}
          onRemove={() => {
            setViewDialog(undefined);
            if (viewDialog.kind === "edit") confirmViewRemoval(viewDialog.view);
          }}
          onClose={closeViewDialog}
        />
      )}
      {goToIssueOpen && (
        <GoToIssueDialog
          from={
            selected?.kind === "repository" ? selected.repository : tab?.from
          }
          login={login}
          onChoose={(issue) => {
            setGoToIssueOpen(false);
            goTo(issue);
          }}
          refocusPane={refocusPane}
          onClose={() => {
            setGoToIssueOpen(false);
          }}
        />
      )}
      {settingsOpen && config && (
        <SettingsDialog config={config} onClose={closeSettings} />
      )}
      {setup?.status === "blocked" && <SetupDialog problem={setup.problem} />}
      <Notices onOpenView={openNoticeView} />
    </OpenInNewTab.Provider>
  );
}

/**
 * An issue opened becomes the first recent issue, if where it lives is
 * known.
 */
function recordRecent(issue: IssueDestination, entry: Scope | undefined) {
  const recent = recentIssueOf(issue, entry);
  if (recent)
    void window.verdandi.recordRecentIssue(recent).catch(() => undefined);
}

/**
 * Gives a pane the keyboard: the element in it marked `data-pane-focus`, such
 * as a list, or else the pane itself.
 */
function focusPane(pane: HTMLElement | null) {
  const target = pane?.querySelector<HTMLElement>("[data-pane-focus]") ?? pane;
  target?.focus({ preventScroll: true });
}

/**
 * Whether the sidebar shows its entries' shortcuts: while ⌘ is held on macOS,
 * or Ctrl elsewhere, and the window is active.
 */
function useShortcutsShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    function follow(event: KeyboardEvent) {
      setShown(modifier.isHeld(event));
    }
    function hide() {
      setShown(false);
    }
    window.addEventListener("keydown", follow);
    window.addEventListener("keyup", follow);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("keydown", follow);
      window.removeEventListener("keyup", follow);
      window.removeEventListener("blur", hide);
    };
  }, []);
  return shown;
}
