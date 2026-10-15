/**
 * PROTOTYPE, throw away: how a list's sort order is chosen.
 *
 * Four variants of a tracked repository's and All's list, switchable with
 * the floating bar at the bottom (or ⌥← / ⌥→):
 *
 * - A: sortable column headers, "Created" and a new "Updated" column
 * - B: a second switch `Newest | Updated` beside `Open | Closed`
 * - C: a menu "Sort: Newest ▾" in the header, as on GitHub
 * - D: one date column whose header is the switch, "Created ↓" ↔ "Updated ↓"
 *
 * Sorting by Updated reorders only the trees, each by the most recently
 * updated match inside it; sub-issues keep GitHub's order, as they do now.
 * The order is per sidebar entry and lasts until quit. Lives only on the
 * branch `prototype/list-sort`.
 */
import type {
  IssueNode,
  IssueState,
  IssueTree,
  Scope,
} from "@verdandi/core/contract";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

export type SortOrder = "newest" | "updated";
export type Variant = "A" | "B" | "C" | "D";

const variants: readonly { key: Variant; name: string }[] = [
  { key: "A", name: "Sortable columns" },
  { key: "B", name: "Switch beside Open | Closed" },
  { key: "C", name: "Sort menu" },
  { key: "D", name: "Date column is the switch" },
];

// The variant, from `?variant=` at launch, then in memory.
let variant: Variant =
  (new URLSearchParams(location.search).get("variant") as Variant | null) ??
  "B";
const variantListeners = new Set<() => void>();
function setVariant(next: Variant) {
  variant = next;
  try {
    const url = new URL(location.href);
    url.searchParams.set("variant", next);
    history.replaceState(history.state, "", url);
  } catch {
    // A file:// page may refuse; memory is enough.
  }
  for (const listener of variantListeners) listener();
}
export function useVariant(): Variant {
  return useSyncExternalStore(
    (listener) => {
      variantListeners.add(listener);
      return () => variantListeners.delete(listener);
    },
    () => variant,
  );
}

// The order of each sidebar entry, until quit.
const orders = new Map<string, SortOrder>();
const orderListeners = new Set<() => void>();
export function useSortOrder(scope: Scope): [SortOrder, (o: SortOrder) => void] {
  const key = JSON.stringify(scope);
  const order = useSyncExternalStore(
    (listener) => {
      orderListeners.add(listener);
      return () => orderListeners.delete(listener);
    },
    () => orders.get(key) ?? "newest",
  );
  return [
    order,
    (next) => {
      orders.set(key, next);
      for (const listener of orderListeners) listener();
    },
  ];
}

/** The trees in the order chosen; "newest" keeps the core's order. */
export function sortTrees(
  trees: IssueTree[],
  order: SortOrder,
  listState: IssueState | undefined,
): IssueTree[] {
  if (order === "newest") return trees;
  function isMatch(node: IssueNode): boolean {
    if (node.unread) return false;
    return node.mark ? node.mark.match : node.issue.state === listState;
  }
  function updated(node: IssueNode): number {
    const time = node.unread ? NaN : Date.parse(node.issue.updatedAt ?? "");
    return Number.isNaN(time) ? -Infinity : time;
  }
  function latest(node: IssueNode): number {
    let time = isMatch(node) ? updated(node) : -Infinity;
    for (const sub of node.subIssues) time = Math.max(time, latest(sub));
    return time;
  }
  return trees
    .map((tree) => {
      const time = latest(tree);
      return { tree, time: time === -Infinity ? updated(tree) : time };
    })
    .sort((a, b) => (a.time === b.time ? 0 : b.time > a.time ? 1 : -1))
    .map(({ tree }) => tree);
}

const orderNames: Record<SortOrder, string> = {
  newest: "Newest",
  updated: "Recently updated",
};

/** B: a segmented control like the one for open and closed. */
export function SortSwitch({
  order,
  onSort,
}: {
  order: SortOrder;
  onSort: (order: SortOrder) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Sort order"
      title="Sort by when opened, or by when last updated"
      className="flex shrink-0 rounded-md border p-0.5 text-xs"
    >
      {(["newest", "updated"] as const).map((option) => {
        const checked = option === order;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={checked}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              onSort(option);
            }}
            className={cn(
              "rounded px-2 py-0.5 text-muted-foreground hover:text-foreground",
              checked && "bg-muted font-medium text-foreground",
            )}
          >
            {option === "newest" ? "Newest" : "Updated"}
          </button>
        );
      })}
    </div>
  );
}

/** C: a button that opens a menu of orders, as on GitHub. */
export function SortMenu({
  order,
  onSort,
}: {
  order: SortOrder;
  onSort: (order: SortOrder) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("mousedown", close);
    };
  }, [open]);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={() => {
          setOpen(!open);
        }}
        className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
      >
        Sort: <span className="text-foreground">{orderNames[order]}</span>
        <ChevronDown aria-hidden className="size-3" />
      </button>
      {open && (
        <div
          role="menu"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          className="absolute top-full left-0 z-30 mt-1 w-52 rounded-md border bg-popover p-1 text-xs shadow-md"
        >
          {(["newest", "updated"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === order}
              onClick={() => {
                onSort(option);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted"
            >
              <Check
                aria-hidden
                className={cn("size-3.5", option !== order && "invisible")}
              />
              {orderNames[option]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The floating bar that flips between the variants. */
export function PrototypeSwitcher() {
  const current = useVariant();
  const index = variants.findIndex((v) => v.key === current);
  const step = (by: number) => {
    const next = variants[(index + by + variants.length) % variants.length];
    if (next) setVariant(next.key);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  });
  return (
    <div
      data-prototype-switcher
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#111] px-1.5 py-1 text-xs text-white shadow-lg ring-1 ring-white/20"
    >
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => {
          step(-1);
        }}
        className="rounded-full px-2 py-0.5 hover:bg-white/15"
      >
        ←
      </button>
      <span className="px-2 tabular-nums">
        <b>{current}</b> · {variants[index]?.name}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => {
          step(1);
        }}
        className="rounded-full px-2 py-0.5 hover:bg-white/15"
      >
        →
      </button>
    </div>
  );
}
