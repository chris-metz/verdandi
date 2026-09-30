import type { Label } from "@verdandi/core/contract";
import { Popover } from "@base-ui/react/popover";
import { X } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { colorStyle, labelColors } from "./row-cells";

/** Keeps the keyboard where it was as a button is clicked. */
function keepFocus(event: MouseEvent) {
  event.preventDefault();
}

/**
 * A label as a pill in GitHub's colour, which adds it to the list's label
 * filter. The row or page it stands in is not clicked with it.
 */
export function LabelPill({
  label,
  onFilter,
  className,
}: {
  label: Label;
  onFilter: (label: Label) => void;
  /** Its size, which differs between rows and pages. */
  className: string;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={`Filter the list by ${label.name}`}
      style={colorStyle(labelColors(label.color))}
      onMouseDown={keepFocus}
      onClick={(event) => {
        event.stopPropagation();
        onFilter(label);
      }}
      className={cn(
        "shrink-0 rounded-full font-medium hover:ring-1 hover:ring-foreground/50",
        className,
      )}
    >
      {label.name}
    </button>
  );
}

/**
 * A row's `+N`, which names the labels it leaves out in its tooltip, and
 * opens a popover with every label of the issue to filter by.
 */
export function MoreLabels({
  labels,
  more,
  onFilter,
}: {
  /** Every label of the issue, in GitHub's order. */
  labels: readonly Label[];
  /** How many labels the row leaves out, and their names. */
  more: { count: number; names: string };
  onFilter: (label: Label) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        ref={trigger}
        tabIndex={-1}
        title={more.names}
        onMouseDown={keepFocus}
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground hover:text-foreground data-popup-open:text-foreground"
      >
        +{more.count}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          className="z-50"
        >
          <Popover.Popup
            aria-label="Labels"
            // The list or page it was opened from has the keyboard again.
            finalFocus={() =>
              trigger.current?.closest<HTMLElement>("[data-pane-focus]") ?? true
            }
            // React passes clicks and keys on to the row it was opened from,
            // and its list or page.
            onClick={(event) => {
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
            }}
            className="flex max-w-80 flex-wrap gap-1 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md outline-none"
          >
            {labels.map((label) => (
              <LabelPill
                key={label.name}
                label={label}
                onFilter={(chosen) => {
                  setOpen(false);
                  onFilter(chosen);
                }}
                className="px-1.5 text-[11px] leading-[18px]"
              />
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * A list's label filter in its header: a chip per label in its colour, with
 * ✕ to remove it, wrapping to further rows as it needs rather than cutting a
 * chip short.
 */
export function LabelFilterChips({
  labels,
  onRemove,
}: {
  labels: readonly Label[];
  onRemove: (name: string) => void;
}) {
  if (labels.length === 0) return null;
  return (
    <ul
      aria-label="Label filter"
      title="Esc clears the label filter"
      // It wraps before what is beside it is cut short.
      className="flex shrink-10 flex-wrap items-center gap-1"
    >
      {labels.map((label) => (
        <li
          key={label.name}
          style={colorStyle(labelColors(label.color))}
          className="flex h-5 items-center gap-0.5 rounded-full pr-0.5 pl-2 text-xs font-medium whitespace-nowrap"
        >
          {label.name}
          <button
            type="button"
            aria-label={`Remove ${label.name} from the label filter`}
            title={`Remove ${label.name}`}
            onMouseDown={keepFocus}
            onClick={() => {
              onRemove(label.name);
            }}
            className="flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-current/20"
          >
            <X aria-hidden className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * What a list shows in place of its issues when none has every label of its
 * label filter, with a button that clears it, as Esc does.
 */
export function NoLabelMatches({
  status,
  onClear,
}: {
  /** What the list says, e.g. "No open issues have bug, ui". */
  status: string;
  onClear: () => void;
}) {
  return (
    <div role="status" className="space-y-3 px-4 py-6">
      <p className="font-medium">{status}</p>
      <Button
        variant="outline"
        size="sm"
        onMouseDown={keepFocus}
        onClick={onClear}
      >
        <X aria-hidden />
        Clear label filter
        <kbd className="font-mono text-[11px] text-muted-foreground">Esc</kbd>
      </Button>
    </div>
  );
}
