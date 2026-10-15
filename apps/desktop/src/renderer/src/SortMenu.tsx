import { Menu } from "@base-ui/react/menu";
import type { IssueState, SortOrder } from "@verdandi/core/contract";
import { Check, ChevronDown } from "lucide-react";
import { useRef } from "react";
import { sortOrderName, sortOrders } from "./sort-order";

/** The one sort menu's trigger: only the list on screen has one. */
const triggerId = "list-sort-menu";
const handle = Menu.createHandle();

/** Opens the sort menu of the list on screen, if a list shows. */
export function openSortMenu() {
  handle.open(triggerId);
}

const itemClass =
  "flex items-center gap-2 rounded px-2 py-1.5 outline-none data-highlighted:bg-accent";

/**
 * The menu "Sort: Newest ▾" in a list's header, which orders the list by
 * one of the sort orders, naming each as the list's state calls it. The pane
 * that had the keyboard, the list or the sidebar, has it again once the menu
 * closes, as it keeps it after the switch beside it.
 */
export function SortMenu({
  order,
  state,
  onSort,
}: {
  order: SortOrder;
  state: IssueState;
  onSort: (order: SortOrder) => void;
}) {
  const returnFocus = useRef<Element | null>(null);
  return (
    <Menu.Root
      handle={handle}
      onOpenChange={(open) => {
        if (open) returnFocus.current = document.activeElement;
      }}
      // Itself, as the menu would give the sidebar's first button the
      // keyboard instead of the sidebar.
      onOpenChangeComplete={(open) => {
        const target = returnFocus.current;
        if (!open && target instanceof HTMLElement && target.isConnected)
          target.focus({ preventScroll: true });
      }}
    >
      <Menu.Trigger
        id={triggerId}
        title="Sort the list (S)"
        // The list keeps the keyboard until the menu takes it.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-popup-open:text-foreground"
      >
        Sort:
        <span className="font-medium text-foreground">
          {sortOrderName(order, state)}
        </span>
        <ChevronDown aria-hidden className="size-3" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" sideOffset={4} className="z-50">
          <Menu.Popup
            finalFocus={false}
            // The menu is no pane: the one that had the keyboard keeps it.
            onFocus={(event) => {
              event.stopPropagation();
            }}
            className="min-w-48 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none"
          >
            <Menu.RadioGroup
              value={order}
              onValueChange={(value: SortOrder) => {
                if (value !== order) onSort(value);
              }}
            >
              {sortOrders.map((option) => (
                <Menu.RadioItem
                  key={option}
                  value={option}
                  closeOnClick
                  className={itemClass}
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center">
                    <Menu.RadioItemIndicator>
                      <Check aria-hidden className="size-3.5" />
                    </Menu.RadioItemIndicator>
                  </span>
                  {sortOrderName(option, state)}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
