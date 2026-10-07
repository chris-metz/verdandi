import type {
  SidebarEntryKey,
  SidebarDestination,
  RepositoryAddress,
  SavedView,
} from "@verdandi/core/contract";
import type { Platform } from "../../shared/ipc";
import { sameScope, type SidebarScope as Scope } from "./scope";

/** The window's two panes, which have the keyboard in turn. */
export type Pane = "sidebar" | "main";

/** A key press, as far as the window reads it. */
export interface KeyPress {
  key: string;
  /** The key's place on the keyboard, e.g. `Digit1`, whatever it types. */
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** What a key asks of the window. */
export type WindowCommand =
  | { kind: "focus"; pane: Pane }
  | { kind: "select"; scope: Scope }
  | { kind: "refresh" }
  | { kind: "switch-state" }
  | { kind: "add-repository" }
  | { kind: "go-to-issue" }
  | { kind: "remove-repository"; repository: RepositoryAddress }
  | { kind: "new-view" }
  | { kind: "edit-view"; view: SavedView }
  | { kind: "duplicate-view"; view: SavedView }
  | { kind: "remove-view"; view: SavedView }
  | {
      kind: "reorder";
      entry: SidebarEntryKey;
      destination: SidebarDestination;
    };

export interface WindowState {
  /** The pane that has the keyboard. */
  focused: Pane;
  /** The sidebar's entries, in visual order. */
  entries: readonly Scope[];
  /** The entry of the tab shown; none for a new tab. */
  selected: Scope | undefined;
  /** The modifier of the sidebar's shortcuts. */
  modifier: ShortcutModifier;
  /** Whether the user hid the sidebar, leaving the window to the main area. */
  sidebarHidden: boolean;
}

/** The modifier of the sidebar's shortcuts: ⌘ on macOS, Ctrl elsewhere. */
export interface ShortcutModifier {
  /** Whether it is held during a key event. */
  isHeld(press: Pick<KeyPress, "metaKey" | "ctrlKey">): boolean;
  /** Names its shortcut with a key, e.g. `⌘1` or `Ctrl+1`. */
  label(key: string): string;
}

export function shortcutModifier(platform: Platform): ShortcutModifier {
  return platform === "darwin"
    ? { isHeld: ({ metaKey }) => metaKey, label: (key) => `⌘${key}` }
    : { isHeld: ({ ctrlKey }) => ctrlKey, label: (key) => `Ctrl+${key}` };
}

/**
 * What a key does in the window before the focused pane gets it: Tab moves
 * the keyboard to the other pane, `r` refreshes what is on screen, `s`
 * switches a repository's or All's list between open and closed issues, `a`
 * opens the repository picker, `#` the Go to Issue dialog over the tab
 * shown, or a new tab's field, `v` the dialog for a new view, `E` the one
 * for the selected view and `V` one for a duplicate of it, ⌘/Ctrl+1…9
 * select the sidebar's entries in visual order, and in the sidebar ↑/↓ or
 * `j`/`k` select the entry above or below at once, F2 edits the view it has
 * and ⌫ asks to remove its entry. Every other key is the
 * focused pane's, so a list's keys work only while the main area has the
 * keyboard. While the sidebar is hidden, the main area keeps the keyboard,
 * Tab too, and the sidebar's own keys do nothing.
 */
export function commandForWindowKey(
  press: KeyPress,
  {
    focused: focusedPane,
    entries,
    selected,
    modifier,
    sidebarHidden,
  }: WindowState,
): WindowCommand | undefined {
  const { key, code, metaKey, ctrlKey, altKey, shiftKey } = press;
  const focused = sidebarHidden ? "main" : focusedPane;
  const select = (scope: Scope | undefined): WindowCommand | undefined =>
    scope && { kind: "select", scope };
  const shortcut = /^Digit([1-9])$/.exec(code);
  const modifiersHeld = [metaKey, ctrlKey, altKey, shiftKey].filter(Boolean);
  // The shortcut modifier, and no other.
  if (shortcut && modifier.isHeld(press) && modifiersHeld.length === 1) {
    return select(entries[Number(shortcut[1]) - 1]);
  }
  if (
    focused === "sidebar" &&
    selected !== undefined &&
    selected.kind !== "all" &&
    altKey &&
    modifiersHeld.length === 1 &&
    (key === "ArrowUp" || key === "ArrowDown")
  ) {
    const index = entries.findIndex((entry) => sameScope(entry, selected));
    const direction = key === "ArrowUp" ? "up" : "down";
    const neighbour = entries[index + (direction === "up" ? -1 : 1)];
    if (neighbour?.kind === selected.kind)
      return {
        kind: "reorder",
        entry:
          selected.kind === "view"
            ? { kind: "view", id: selected.view.id }
            : selected,
        destination: { direction },
      };
    return undefined;
  }
  if (metaKey || ctrlKey || altKey) return undefined;
  if (key === "Tab") {
    return {
      kind: "focus",
      pane: focused === "sidebar" || sidebarHidden ? "main" : "sidebar",
    };
  }
  if (key === "r") return { kind: "refresh" };
  if (key === "s" && selected !== undefined && selected.kind !== "view") {
    return { kind: "switch-state" };
  }
  if (key === "a") return { kind: "add-repository" };
  // `#` is its own key on some layouts, and Shift+3 on others.
  if (key === "#") {
    return selected === undefined
      ? { kind: "focus", pane: "main" }
      : { kind: "go-to-issue" };
  }
  if (key === "v" && !shiftKey) return { kind: "new-view" };
  if (key === "E" && selected?.kind === "view") {
    return { kind: "edit-view", view: selected.view };
  }
  if (key === "V" && selected?.kind === "view") {
    return { kind: "duplicate-view", view: selected.view };
  }
  if (focused !== "sidebar") return undefined;
  if (key === "Backspace" && !shiftKey && selected?.kind === "repository") {
    return { kind: "remove-repository", repository: selected.repository };
  }
  if (key === "Backspace" && !shiftKey && selected?.kind === "view") {
    return { kind: "remove-view", view: selected.view };
  }
  if (key === "F2" && selected?.kind === "view") {
    return { kind: "edit-view", view: selected.view };
  }
  const index =
    selected === undefined
      ? -1
      : entries.findIndex((entry) => sameScope(entry, selected));
  switch (key) {
    case "j":
    case "ArrowDown":
      return select(entries[index + 1]);
    case "k":
    case "ArrowUp":
      return select(index < 0 ? entries[0] : entries[index - 1]);
    default:
      return undefined;
  }
}

/**
 * Which way a key steps through the tabs, wherever the keyboard is: Ctrl+Tab
 * to the next tab and Ctrl+Shift+Tab to the previous one, as ⌘⇧] and ⌘⇧[
 * do on macOS and Ctrl+PageDown and Ctrl+PageUp elsewhere.
 */
export function tabStepForKey(
  { key, code, metaKey, ctrlKey, altKey, shiftKey }: KeyPress,
  platform: Platform,
): 1 | -1 | undefined {
  if (altKey) return undefined;
  if (ctrlKey && !metaKey && key === "Tab") return shiftKey ? -1 : 1;
  if (platform === "darwin") {
    if (!metaKey || ctrlKey || !shiftKey) return undefined;
    if (code === "BracketRight") return 1;
    if (code === "BracketLeft") return -1;
    return undefined;
  }
  if (!ctrlKey || metaKey || shiftKey) return undefined;
  if (key === "PageDown") return 1;
  if (key === "PageUp") return -1;
  return undefined;
}

/**
 * The shortcut that selects the sidebar entry at a position in visual order,
 * counted from 0. Only the first nine have one.
 */
export function entryShortcut(
  position: number,
  modifier: ShortcutModifier,
): string | undefined {
  if (position < 0 || position > 8) return undefined;
  return modifier.label(String(position + 1));
}
