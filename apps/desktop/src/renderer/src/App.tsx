import type { Scope, Screen } from "@verdandi/core/contract";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { navigateIssues } from "./issue-navigation";
import { MainArea } from "./MainArea";
import {
  commandForWindowKey,
  shortcutModifier,
  type Pane,
} from "./pane-navigation";
import { sameScope, scopeLabel } from "./scope";
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
 * read again with `r`, and when it is old as the window regains focus.
 */
export function App() {
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
    return selected && { kind: "list", scope: selected };
  }, [selected, shownIssueId]);
  const [focused, setFocused] = useState<Pane>("sidebar");
  const shortcutsShown = useShortcutsShown();
  const sidebarPane = useRef<HTMLElement>(null);
  const mainPane = useRef<HTMLElement>(null);

  /** Selects an entry, whose list starts without issue pages on top. */
  function select(scope: Scope) {
    if (selected && sameScope(scope, selected)) return;
    setSelected(scope);
    navigate({ kind: "list" });
  }

  // Nothing is selected at first, so the sidebar has the keyboard.
  useEffect(() => {
    focusPane(sidebarPane.current);
  }, []);

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
      // A key the focused pane has handled is not the window's.
      if (event.defaultPrevented) return;
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
        case "refresh":
          void window.verdandi.refresh(screen);
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  return (
    <div className="flex h-screen text-sm">
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
          items={items}
          selected={selected}
          onSelect={select}
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
            stack={stack}
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
