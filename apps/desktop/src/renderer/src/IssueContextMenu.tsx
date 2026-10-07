import { ContextMenu } from "@base-ui/react/context-menu";
import { useRef, useState, type ReactElement } from "react";

/** What a right click on an issue in a pane offers. */
export interface IssueMenuTarget {
  /** Opens the issue in a new tab, in the background. */
  openInNewTab: () => void;
  /** Its page on github.com, if known. */
  url: string | undefined;
  /** The link to it that was right-clicked in a body or comment, if any. */
  link?: string | undefined;
}

const itemClass = "rounded px-2 py-1.5 outline-none data-highlighted:bg-accent";

/**
 * The menu a right click on an issue opens in a pane, on a row, a card, an
 * ancestor in the breadcrumb, or a link to an issue in a body or comment:
 * Open in New Tab first, then Open on GitHub, and Copy Link on a link. A
 * right click on anything else in the pane opens nothing. One menu serves
 * the whole pane, `children`, finding the issue from what was clicked. What
 * had the keyboard has it again once the menu closes, as a body's text
 * cannot hold it.
 */
export function IssueContextMenu({
  targetAt,
  children,
}: {
  /** What an element right-clicked stands for, if it is an issue. */
  targetAt: (element: Element) => IssueMenuTarget | undefined;
  children: ReactElement;
}) {
  const [target, setTarget] = useState<IssueMenuTarget>();
  const returnFocus = useRef<Element | null>(null);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={children}
        onContextMenu={(event) => {
          const found =
            event.target instanceof Element
              ? targetAt(event.target)
              : undefined;
          if (!found) {
            event.preventBaseUIHandler();
            return;
          }
          setTarget(found);
          returnFocus.current = document.activeElement;
        }}
      />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-50">
          <ContextMenu.Popup
            finalFocus={() =>
              returnFocus.current instanceof HTMLElement &&
              returnFocus.current.isConnected
                ? returnFocus.current
                : true
            }
            className="min-w-48 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none"
          >
            {target && (
              <>
                <ContextMenu.Item
                  onClick={target.openInNewTab}
                  className={itemClass}
                >
                  Open in New Tab
                </ContextMenu.Item>
                {target.url !== undefined && (
                  <ContextMenu.Item
                    onClick={() => {
                      if (target.url) window.desktop.openExternal(target.url);
                    }}
                    className={itemClass}
                  >
                    Open on GitHub
                  </ContextMenu.Item>
                )}
                {target.link !== undefined && (
                  <ContextMenu.Item
                    onClick={() => {
                      if (target.link)
                        void navigator.clipboard.writeText(target.link);
                    }}
                    className={itemClass}
                  >
                    Copy Link
                  </ContextMenu.Item>
                )}
              </>
            )}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
