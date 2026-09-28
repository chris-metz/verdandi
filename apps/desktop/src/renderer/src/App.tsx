import type {
  SidebarEntryKey,
  SidebarDestination,
  Screen,
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
import { sameScope, scopeLabel, type SidebarScope as Scope } from "./scope";
import { SetupDialog, useSetup } from "./SetupDialog";
import { Sidebar, useSidebar } from "./Sidebar";
import { entryOrder } from "./sidebar-entries";

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
 * the selected entry's list. While the setup blocker is up, everything behind
 * it stays as it was but is inert; once it goes, the pane that had the
 * keyboard has it again.
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
    return selected && selected.kind !== "view"
      ? { kind: "list", scope: selected }
      : undefined;
  }, [selected, shownIssueId]);
  const [focused, setFocused] = useState<Pane>("sidebar");
  const shortcutsShown = useShortcutsShown();
  const [settingsError, setSettingsError] = useState<string>();
  const sidebarPane = useRef<HTMLElement>(null);
  const mainPane = useRef<HTMLElement>(null);
  const [picking, setPicking] = useState(false);
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
      }),
    [],
  );

  // A hand edit or Reset can remove the selected entry or rename a view.
  useEffect(() =>
    window.verdandi.on("sidebarChanged", (changed) => {
      if (!selected || changed.status !== "read") return;
      const current = entryOrder(changed).find((item) =>
        sameScope(item.scope, selected),
      )?.scope;
      if (!current) select({ kind: "all" });
      else if (
        current.kind === "view" &&
        selected.kind === "view" &&
        (current.view.name !== selected.view.name ||
          current.view.query !== selected.view.query)
      )
        setSelected(current);
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
      if (event.defaultPrevented || blocked || picking) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          "button, input, textarea, select, [contenteditable=true]",
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
          {selected?.kind === "view" ? (
            <header className="border-b p-4">
              <h1 className="font-semibold">{selected.view.name}</h1>
              <p className="mt-1 text-muted-foreground">
                {selected.view.query}
              </p>
            </header>
          ) : selected ? (
            // A new scope starts from a fresh list, never the previous one's.
            <MainArea
              key={scopeLabel(selected)}
              scope={selected}
              stack={stack}
              login={login}
              onNavigate={navigate}
              hasKeyboard={focused === "main"}
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
      {setup?.status === "blocked" && <SetupDialog problem={setup.problem} />}
      <Notices />
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
