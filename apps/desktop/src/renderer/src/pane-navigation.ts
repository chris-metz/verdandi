import type {
  SidebarEntryKey,
  SidebarDestination,
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
  selected: Scope | undefined;
  /** The modifier of the sidebar's shortcuts. */
  modifier: ShortcutModifier;
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
 * the keyboard to the other pane, `r` refreshes what is on screen, ⌘/Ctrl+1…9
 * select the sidebar's entries in visual order, and in the sidebar ↑/↓ or
 * `j`/`k` select the entry above or below at once. Every other key is the
 * focused pane's, so a list's keys work only while the main area has the
 * keyboard.
 */
export function commandForWindowKey(
  press: KeyPress,
  { focused, entries, selected, modifier }: WindowState,
): WindowCommand | undefined {
  const { key, code, metaKey, ctrlKey, altKey, shiftKey } = press;
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
    return { kind: "focus", pane: focused === "sidebar" ? "main" : "sidebar" };
  }
  if (key === "r") return { kind: "refresh" };
  if (focused !== "sidebar") return undefined;
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
