import type {
  RepositoryAddress,
  SavedView,
  SidebarEntryKey,
  SidebarDestination,
  Screen,
  TrackedRepository,
} from "@verdandi/core/contract";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { navigateIssues } from "./issue-navigation";
import { MainArea } from "./MainArea";
import { Notices } from "./Notices";
import {
  commandForWindowKey,
  shortcutModifier,
  type Pane,
} from "./pane-navigation";
import { RepositoryPicker } from "./RepositoryPicker";
import { RemoveEntryDialog, type RemovableEntry } from "./RemoveEntryDialog";
import { forgetPlace, movePlace } from "./list-places";
import { problemText } from "./problem-text";
import { unavailableText } from "./repository-picker";
import {
  repositoryLabel,
  sameScope,
  scopeLabel,
  type SidebarScope as Scope,
} from "./scope";
import { SetupDialog, useSetup } from "./SetupDialog";
import { Sidebar, useSidebar } from "./Sidebar";
import { entryOrder, followSelection } from "./sidebar-entries";
import { ViewDialog } from "./ViewDialog";
import type { ViewDialogPurpose } from "./view-dialog";

/** Shortcuts use ⌘ on macOS and Ctrl elsewhere. */
const modifier = shortcutModifier(window.desktop.platform);

/** The mark on the pane that has the keyboard: an accent edge on top. */
const focusedPaneMark = "shadow-[inset_0_2px_0_var(--selection-edge)]";

/**
 * The window: the sidebar and the main area, which have the keyboard in turn.
 * The pane that has it follows the DOM focus, and survives the main area's
 * list being replaced when another entry is selected. What is on screen is
 * read again with `r`, and when it is old as the window regains focus. When
 * GitHub is read as another account, the issue pages opened are dropped for
 * the selected entry's list. A repository renamed or transferred stays
 * selected under its new name, with its issue pages and place in its list.
 * While the setup blocker is up, everything behind it stays as it was but
 * is inert; once it goes, the pane that had the keyboard has it again.
 */
export function App() {
  const setup = useSetup();
  const blocked = setup?.status === "blocked";
  const sidebar = useSidebar();
  const items = useMemo(() => entryOrder(sidebar), [sidebar]);
  const entries = useMemo(() => items.map((item) => item.scope), [items]);
  const [selected, setSelected] = useState<Scope>();
  // The issue pages opened from the selected entry's list, the last on top.
  const [stack, navigate] = useReducer(navigateIssues, []);
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
  const [focused, setFocused] = useState<Pane>("sidebar");
  const shortcutsShown = useShortcutsShown();
  const [settingsError, setSettingsError] = useState<string>();
  const sidebarPane = useRef<HTMLElement>(null);
  const mainPane = useRef<HTMLElement>(null);
  const [picking, setPicking] = useState(false);
  /** The sidebar entry whose removal is being confirmed. */
  const [removing, setRemoving] = useState<RemovableEntry>();
  const removalPending = useRef(false);
  /**
   * The renames the core announced, by the old `owner/name` in lower case,
   * to follow a selection that does not know its repository's ID.
   */
  const renamed = useRef(new Map<string, RepositoryAddress>());
  /** The view dialog, open for a new view, or to edit or duplicate a view. */
  const [viewDialog, setViewDialog] = useState<ViewDialogPurpose>();
  const dialogOpen =
    picking || removing !== undefined || viewDialog !== undefined;
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

  /** Closes the picker, giving the pane that had the keyboard it again. */
  function closePicker() {
    setPicking(false);
    focusPane((focused === "sidebar" ? sidebarPane : mainPane).current);
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
    focusPane((focused === "sidebar" ? sidebarPane : mainPane).current);
  }

  /** Shows a view just saved, with its list in front of any issue page. */
  function showSaved(view: SavedView) {
    setViewDialog(undefined);
    const scope = { kind: "view" as const, view };
    if (selected && sameScope(selected, scope)) {
      setSelected(scope);
      navigate({ kind: "list" });
    } else select(scope);
    focusPane(mainPane.current);
  }

  /** Selects an entry, whose list starts without issue pages on top. */
  function select(scope: Scope) {
    if (selected && sameScope(scope, selected)) return;
    setSelected(scope);
    navigate({ kind: "list" });
  }

  // Restore only the sidebar entry; the issue stack and list places start fresh.
  useEffect(() => {
    let current = true;
    void window.verdandi.getSelectedSidebarEntry().then(
      (entry) => {
        if (current) setSelected((selected) => selected ?? entry);
      },
      () => {
        if (current) setSelected((selected) => selected ?? { kind: "all" });
      },
    );
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    void window.verdandi
      .selectSidebarEntry(
        selected.kind === "view"
          ? { kind: "view", id: selected.view.id }
          : selected,
      )
      .catch(() => undefined);
  }, [selected]);

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

  // The sidebar has the keyboard at launch.
  useEffect(() => {
    focusPane(sidebarPane.current);
  }, []);

  // Back from the setup blocker, the pane that had the keyboard has it again.
  const blockedBefore = useRef(blocked);
  useEffect(() => {
    const wasBlocked = blockedBefore.current;
    blockedBefore.current = blocked;
    if (wasBlocked && !blocked) {
      focusPane((focused === "sidebar" ? sidebarPane : mainPane).current);
    }
  }, [blocked, focused]);

  // The issue pages were opened as the previous account, which may be all
  // that could read them: the selected entry's list is read anew instead.
  useEffect(
    () =>
      window.verdandi.on("notice", (notice) => {
        if (notice.kind === "account-changed") navigate({ kind: "list" });
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

  // A hand edit or Reset can remove the selected entry or rename a view,
  // and GitHub can rename or transfer a repository, which stays selected
  // with its issue pages.
  useEffect(() =>
    window.verdandi.on("sidebarChanged", (changed) => {
      if (!selected || changed.status !== "read") return;
      const current = followSelection(
        selected,
        entryOrder(changed).map((item) => item.scope),
        renamed.current,
      );
      if (!current && !removalPending.current) select({ kind: "all" });
      else if (
        current?.kind === "view" &&
        selected.kind === "view" &&
        (current.view.name !== selected.view.name ||
          current.view.query !== selected.view.query)
      )
        setSelected(current);
      else if (
        current?.kind === "repository" &&
        !sameScope(current, selected)
      ) {
        movePlace(selected, current);
        setSelected(current);
      }
    }),
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
      if (
        event.target instanceof Element &&
        event.target.closest(
          "button, input, textarea, select, [contenteditable=true], [role=menu]",
        )
      )
        return;
      const command = commandForWindowKey(event, {
        focused,
        entries,
        selected,
        modifier,
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
        case "add-repository":
          openPicker();
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
    <>
      <div className="flex h-screen text-sm" inert={blocked}>
        <aside
          ref={sidebarPane}
          tabIndex={-1}
          onFocus={() => {
            setFocused("sidebar");
          }}
          className={cn(
            "flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground outline-none",
            focused === "sidebar" && focusedPaneMark,
          )}
        >
          <Sidebar
            sidebar={sidebar}
            setup={setup}
            items={items}
            selected={selected}
            onSelect={select}
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
            setFocused("main");
            // A click beside the list still gives the list the keyboard.
            if (event.target === event.currentTarget) {
              focusPane(event.currentTarget);
            }
          }}
          className={cn(
            "flex min-w-0 flex-1 flex-col outline-none",
            focused === "main" && focusedPaneMark,
          )}
        >
          {selected ? (
            // A new scope starts from a fresh list, never the previous one's.
            <MainArea
              key={scopeLabel(selected)}
              scope={selected}
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
                if (selected.kind === "view") editView(selected.view);
              }}
              stack={stack}
              login={login}
              onNavigate={navigate}
              hasKeyboard={focused === "main" && !dialogOpen && !blocked}
            />
          ) : (
            <p className="m-auto text-muted-foreground">
              Select All or a repository.
            </p>
          )}
        </main>
      </div>
      {picking && (
        <RepositoryPicker
          firstLaunch={sidebar?.status === "read" && sidebar.firstLaunch}
          settingsProblem={
            sidebar?.status === "failed"
              ? sidebar.message
              : sidebar?.status === "read" &&
                  sidebar.settings.status !== "writable"
                ? sidebar.settings.message
                : undefined
          }
          login={login}
          onClose={closePicker}
        />
      )}
      {removing && (
        <RemoveEntryDialog
          entry={removing}
          returnFocus={sidebarPane}
          onRemove={async () => {
            removalPending.current = true;
            try {
              return await (removing.kind === "repository"
                ? window.verdandi.removeRepository(removing.repository)
                : window.verdandi.removeView(removing.view.id));
            } finally {
              removalPending.current = false;
            }
          }}
          onRemoved={(selection) => {
            forgetPlace(removing);
            if (selected && sameScope(selected, removing)) select(selection);
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
          tracked={
            sidebar?.status === "read"
              ? sidebar.repositories.map(({ repository }) => repository)
              : []
          }
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
      {setup?.status === "blocked" && <SetupDialog problem={setup.problem} />}
      <Notices onOpenView={openNoticeView} />
    </>
  );
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
