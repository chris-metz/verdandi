import { ContextMenu } from "@base-ui/react/context-menu";
import type { RepositoryAddress } from "@verdandi/core/contract";
import { ListFilter, Plus, X } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { AllIcon } from "./AllIcon";
import {
  fitTabName,
  shortened,
  type ShorteningPart,
  type TabNameFit,
} from "./tab-name-fit";
import { tabTitle, type Tab, type TabTitle } from "./tabs";

const itemClass =
  "rounded px-2 py-1.5 outline-none data-highlighted:bg-accent data-disabled:opacity-50";

/**
 * The tabs over the main area, in one slim row, the tab shown marked by an
 * accent line under it, the sidebar's button at the left end, and + at the
 * right end with its shortcut. A tab is named after its sidebar entry,
 * with its icon, and the issue it shows dimmed after it. Tabs shrink to a
 * minimum width, their names shortening, the issue's repository first and
 * its number never, then the row scrolls sideways, keeping the tab shown
 * in view. A click shows a tab, a middle click or its × closes it,
 * and a right click offers to close it, the others, or those to its right.
 * Tabs are reordered by dragging. None takes the keyboard from the panes,
 * and the main area's mark of having it shows through the row.
 */
export function TabBar({
  sidebarButton,
  tabs,
  tracked,
  shown,
  newTabShortcut,
  onShow,
  onClose,
  onCloseOthers,
  onCloseRight,
  onMove,
  onNew,
}: {
  /** The button that hides and shows the sidebar. */
  sidebarButton: ReactNode;
  tabs: readonly Tab[];
  /** The tracked repositories, which a tab names by their name alone. */
  tracked: readonly RepositoryAddress[];
  /** The ID of the tab shown. */
  shown: number;
  /** ⌘T, or Ctrl+T. */
  newTabShortcut: string;
  onShow: (id: number) => void;
  onClose: (id: number) => void;
  onCloseOthers: (id: number) => void;
  onCloseRight: (id: number) => void;
  /** Moves a tab before or after another, where it was dropped. */
  onMove: (id: number, target: number, side: "before" | "after") => void;
  onNew: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const dragged = useRef<number | undefined>(undefined);
  const [drop, setDrop] = useState<{ id: number; side: "before" | "after" }>();

  // The tab shown stays in view as the row scrolls sideways.
  useLayoutEffect(() => {
    row.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [shown, tabs.length]);

  /** Which side of a tab a drag over it drops on. */
  function sideOf(event: DragEvent<HTMLElement>): "before" | "after" {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
  }

  return (
    <div className="flex h-line-9 shrink-0 items-stretch border-b text-xs">
      {sidebarButton}
      <div
        ref={row}
        role="tablist"
        aria-label="Tabs"
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]"
      >
        {tabs.map((tab, index) => {
          const title = tabTitle(tab, tracked);
          const selected = tab.id === shown;
          const element = (
            <div
              role="tab"
              aria-selected={selected}
              // The name in full, as what shows may be shortened.
              aria-label={title.tooltip}
              title={title.tooltip}
              draggable
              onMouseDown={(event) => {
                if (event.button === 0) onShow(tab.id);
                // A middle click closes, rather than scrolling.
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button === 1) onClose(tab.id);
              }}
              onDragStart={(event) => {
                dragged.current = tab.id;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", title.tooltip);
              }}
              onDragOver={(event) => {
                if (dragged.current === undefined) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDrop({ id: tab.id, side: sideOf(event) });
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged.current !== undefined)
                  onMove(dragged.current, tab.id, sideOf(event));
                dragged.current = undefined;
                setDrop(undefined);
              }}
              onDragEnd={() => {
                dragged.current = undefined;
                setDrop(undefined);
              }}
              className={cn(
                "group relative flex max-w-64 min-w-32 flex-1 items-center gap-1.5 border-r px-3 text-xs select-none",
                selected
                  ? "bg-muted/40 text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-selection-edge"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                drop?.id === tab.id &&
                  (drop.side === "before"
                    ? "shadow-[inset_2px_0_0_var(--ring)]"
                    : "shadow-[inset_-2px_0_0_var(--ring)]"),
              )}
            >
              {title.kind === "all" ? (
                <AllIcon className="size-3.5 shrink-0 opacity-70" />
              ) : title.kind === "view" ? (
                <ListFilter
                  aria-hidden
                  className="size-3.5 shrink-0 opacity-70"
                />
              ) : title.kind === "new" ? (
                <Plus aria-hidden className="size-3.5 shrink-0 opacity-70" />
              ) : null}
              <TabName title={title} selected={selected} />
              <button
                type="button"
                aria-label="Close Tab"
                tabIndex={-1}
                // Closing a tab does not show it first.
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={() => {
                  onClose(tab.id);
                }}
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                  selected ? "visible" : "invisible group-hover:visible",
                )}
              >
                <X aria-hidden className="size-3" />
              </button>
            </div>
          );
          return (
            <ContextMenu.Root key={tab.id}>
              <ContextMenu.Trigger render={element} />
              <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-50">
                  <ContextMenu.Popup className="min-w-48 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none">
                    <ContextMenu.Item
                      onClick={() => {
                        onClose(tab.id);
                      }}
                      className={itemClass}
                    >
                      Close Tab
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      disabled={tabs.length < 2}
                      onClick={() => {
                        onCloseOthers(tab.id);
                      }}
                      className={itemClass}
                    >
                      Close Other Tabs
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      disabled={index === tabs.length - 1}
                      onClick={() => {
                        onCloseRight(tab.id);
                      }}
                      className={itemClass}
                    >
                      Close Tabs to the Right
                    </ContextMenu.Item>
                  </ContextMenu.Popup>
                </ContextMenu.Positioner>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="New Tab"
        title={`New Tab (${newTabShortcut})`}
        // The keyboard goes to the new tab, not to this button.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={onNew}
        className="flex shrink-0 items-center gap-1.5 border-l px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus aria-hidden className="size-3.5" />
        <kbd className="font-sans">{newTabShortcut}</kbd>
      </button>
    </div>
  );
}

/**
 * A tab's name in the room it has, shortened as `fitTabName` says. Should
 * even the issue alone not fit, its start gives way, and its number stays
 * whole. A hidden whole copy of the name measures what each part takes.
 */
function TabName({ title, selected }: { title: TabTitle; selected: boolean }) {
  const room = useRef<HTMLSpanElement>(null);
  const copy = useRef<HTMLSpanElement>(null);
  const entry = useRef<HTMLSpanElement>(null);
  const separator = useRef<HTMLSpanElement>(null);
  const repository = useRef<HTMLSpanElement>(null);
  const number = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<TabNameFit>();
  const { name, issue } = title;

  // Measured again as the tab narrows or widens, and as its font changes,
  // which changes the whole copy's width.
  useLayoutEffect(() => {
    const observed = [room.current, copy.current];
    function measure() {
      const next = fitTabName(
        room.current?.getBoundingClientRect().width ?? 0,
        measuredPart(entry.current),
        separator.current && number.current
          ? {
              separator: separator.current.getBoundingClientRect().width,
              repository: repository.current
                ? measuredPart(repository.current)
                : undefined,
              number: number.current.getBoundingClientRect().width,
            }
          : undefined,
      );
      setFit((fit) =>
        fit &&
        fit.entry === next.entry &&
        fit.repository === next.repository &&
        fit.fits === next.fits
          ? fit
          : next,
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of observed) if (element) observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [name, issue?.repository, issue?.number, selected]);

  const entryShown = !fit
    ? name
    : fit.entry === undefined
      ? undefined
      : shortened(name, fit.entry);
  return (
    <span
      ref={room}
      className={cn(
        "relative flex min-w-0 flex-1 overflow-hidden whitespace-pre",
        fit?.fits === false && "justify-end",
      )}
    >
      {entryShown !== undefined && (
        <span className={cn(selected && "font-medium")}>{entryShown}</span>
      )}
      {issue && (
        <span className="text-muted-foreground tabular-nums">
          {entryShown !== undefined && " › "}
          {issue.repository !== undefined &&
            (fit?.repository === undefined
              ? issue.repository
              : shortened(issue.repository, fit.repository))}
          {issue.number}
        </span>
      )}
      <span
        aria-hidden
        className="invisible absolute top-0 left-0 size-0 overflow-hidden"
      >
        <span ref={copy} className="flex w-max">
          <span ref={entry} className={cn(selected && "font-medium")}>
            {`${name}…`}
          </span>
          {issue && (
            <span className="flex tabular-nums">
              <span ref={separator}>{" › "}</span>
              {issue.repository !== undefined && (
                <span ref={repository}>{`${issue.repository}…`}</span>
              )}
              <span ref={number}>{issue.number}</span>
            </span>
          )}
        </span>
      </span>
    </span>
  );
}

/**
 * What a part of the name takes, measured in its whole copy: the widths of
 * its first characters, and of the `…` it ends in.
 */
function measuredPart(whole: HTMLElement | null): ShorteningPart {
  const text = whole?.firstChild;
  if (!(text instanceof Text)) return { widths: [0], ellipsis: 0 };
  const range = document.createRange();
  const widthTo = (start: number, end: number) => {
    range.setStart(text, start);
    range.setEnd(text, end);
    return range.getBoundingClientRect().width;
  };
  const widths = [0];
  let end = 0;
  for (const character of text.data.slice(0, -1)) {
    end += character.length;
    widths.push(widthTo(0, end));
  }
  return { widths, ellipsis: widthTo(end, end + 1) };
}
