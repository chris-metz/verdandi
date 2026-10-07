import { createContext, useContext } from "react";
import type { IssueDestination } from "./issue-navigation";
import { shortcutModifier, type KeyPress } from "./pane-navigation";

/**
 * Opens an issue in a new tab, in the background, over the list of the tab
 * shown's entry. Wherever an issue opens in the app, it opens in a new tab
 * too, so the window offers it to every pane alike.
 */
export const OpenInNewTab = createContext<
  ((issue: IssueDestination) => void) | undefined
>(undefined);

/** Open in New Tab, where the window offers it. */
export function useOpenInNewTab() {
  return useContext(OpenInNewTab);
}

/**
 * Whether a click opens in a new tab: a middle click, or a click with ⌘
 * held on macOS and Ctrl elsewhere, as in a browser.
 */
export function opensInNewTab(
  click: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey">,
): boolean {
  return (
    click.button === 1 ||
    (click.button === 0 &&
      shortcutModifier(window.desktop.platform).isHeld(click))
  );
}

/**
 * Opens an issue where a click asks: in a new tab, as `opensInNewTab` says,
 * and otherwise as `open` does.
 */
export function useOpenFrom(open: (issue: IssueDestination) => void) {
  const openInNewTab = useOpenInNewTab();
  return (
    click: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey">,
    issue: IssueDestination,
  ) => {
    if (openInNewTab && opensInNewTab(click)) openInNewTab(issue);
    else open(issue);
  };
}

/** A middle click opens in a new tab, rather than scrolling as it moves. */
export function preventAutoscroll(
  event: Pick<MouseEvent, "button" | "preventDefault">,
) {
  if (event.button === 1) event.preventDefault();
}

/** Whether a key opens what the cursor is on in a new tab: ⌘↩, or Ctrl+↩. */
export function isNewTabKey(
  press: Pick<KeyPress, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): boolean {
  return (
    press.key === "Enter" &&
    !press.altKey &&
    !press.shiftKey &&
    press.metaKey !== press.ctrlKey &&
    shortcutModifier(window.desktop.platform).isHeld(press)
  );
}
