import { Check } from "lucide-react";
import {
  Fragment,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { shippedFonts } from "../../shared/fonts";
import { fontStack, type FontUse } from "./fonts";
import { isMonospace, type FontList } from "./installed-fonts";

/** One entry of the list: a family, or the default, which is none. */
interface Entry {
  family: string | null;
  label: string;
  /** What is said beside it, e.g. the default's name. */
  note?: string;
  /** A heading shown above it, which starts a group. */
  heading?: string;
  /** Whether choosing it does nothing, as it is not installed. */
  unavailable?: boolean;
}

/**
 * A searchable list of the font families to choose from for a use, each
 * shown in its own face: "Default" first, then the family `config.toml`
 * names if it is not installed, then the families, monospace ones first for
 * code. The field keeps the keyboard: typing searches, ↑/↓ move, and Enter
 * chooses, as a click does. The choice applies at once.
 */
export function FontPicker({
  labelId,
  use,
  chosen,
  missing,
  fonts,
  disabled,
  onChoose,
}: {
  /** The ID of the setting's name, which labels the list. */
  labelId: string;
  use: FontUse;
  /** The family Verdandi uses, or null for the default. */
  chosen: string | null;
  /** The family `config.toml` names that is not installed, if it does. */
  missing: string | undefined;
  /** The families, once listed. */
  fonts: FontList | undefined;
  disabled: boolean;
  /** Chooses a family, or the default for null. */
  onChoose: (family: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const entries = useMemo(
    () => fontEntries(use, chosen, missing, fonts, query),
    [use, chosen, missing, fonts, query],
  );
  const checked = (entry: Entry) =>
    missing === undefined
      ? entry.family === chosen
      : entry.family === missing && entry.unavailable === true;
  // The entry the keyboard is on: the checked one until it moves, also once
  // the families are listed, and the first one as the search changes.
  const [highlight, setHighlight] = useState<
    { key: string } | "checked" | "first"
  >("checked");
  const cursor = Math.max(
    highlight === "first"
      ? 0
      : highlight === "checked"
        ? entries.findIndex(checked)
        : entries.findIndex((entry) => entryKey(entry) === highlight.key),
    0,
  );
  function moveTo(index: number) {
    const entry = entries[index];
    if (entry) setHighlight({ key: entryKey(entry) });
  }
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);

  // What the keyboard is on stays in sight in the list, without scrolling
  // the dialog around it.
  useLayoutEffect(() => {
    const scroller = list.current;
    const item = scroller?.querySelector<HTMLElement>(
      '[data-highlighted="true"]',
    );
    if (!scroller || !item) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (bottom > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = bottom - scroller.clientHeight;
  }, [cursor, entries]);

  // The checked entry too: Default replaces a value of the wrong type, and
  // a value the file has already writes nothing.
  function choose(entry: Entry | undefined) {
    if (!entry || entry.unavailable || disabled) return;
    onChoose(entry.family);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case "ArrowDown":
        moveTo(Math.min(cursor + 1, entries.length - 1));
        break;
      case "ArrowUp":
        moveTo(Math.max(cursor - 1, 0));
        break;
      case "Enter":
        choose(entries[cursor]);
        break;
      case "Escape":
        if (query === "") return;
        // Only the search is cleared, not the dialog closed.
        event.stopPropagation();
        setQuery("");
        setHighlight("first");
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-md border focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        disabled && "opacity-50",
      )}
    >
      <input
        type="text"
        role="combobox"
        aria-labelledby={labelId}
        aria-controls={listId}
        aria-expanded
        aria-autocomplete="list"
        aria-activedescendant={
          entries.length > 0 ? `${listId}-${String(cursor)}` : undefined
        }
        value={query}
        disabled={disabled}
        placeholder="Search fonts"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight("first");
        }}
        onKeyDown={onKeyDown}
        className="h-8 border-b bg-transparent px-2.5 outline-none placeholder:text-muted-foreground"
      />
      <ul
        ref={list}
        id={listId}
        role="listbox"
        aria-labelledby={labelId}
        className="relative h-52 overflow-y-auto p-1"
      >
        {entries.map((entry, index) => {
          const isChecked = checked(entry);
          const highlighted = index === cursor;
          return (
            <Fragment key={entryKey(entry)}>
              {entry.heading && (
                <li
                  role="presentation"
                  className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground"
                >
                  {entry.heading}
                </li>
              )}
              <li
                id={`${listId}-${String(index)}`}
                role="option"
                aria-selected={isChecked}
                aria-disabled={disabled || entry.unavailable === true}
                data-highlighted={highlighted}
                title={entry.family ?? undefined}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  moveTo(index);
                  choose(entry);
                }}
                // Rows out of sight are not drawn, nor their fonts loaded.
                className={cn(
                  "flex h-7 cursor-default items-center gap-1.5 rounded px-2 select-none [content-visibility:auto]",
                  highlighted
                    ? "bg-selection shadow-[inset_2px_0_0_var(--selection-edge)]"
                    : !disabled && !entry.unavailable && "hover:bg-muted",
                )}
              >
                <Check
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-selection-edge",
                    !isChecked && "invisible",
                  )}
                />
                <span
                  className={cn(
                    "min-w-0 truncate",
                    entry.unavailable && "text-muted-foreground line-through",
                  )}
                  style={{ fontFamily: fontStack(entry.family, use) }}
                >
                  {entry.label}
                </span>
                {entry.note && (
                  <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">
                    {entry.note}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
        {fonts === undefined && (
          <li
            role="presentation"
            className="px-2 py-1 text-xs text-muted-foreground"
          >
            Listing installed fonts…
          </li>
        )}
        {fonts?.failure !== undefined && (
          <li
            role="presentation"
            className="px-2 py-1 text-xs break-words text-muted-foreground"
          >
            Installed fonts cannot be listed: {fonts.failure}
          </li>
        )}
        {fonts !== undefined && entries.length === 0 && (
          <li
            role="presentation"
            className="px-2 py-1 text-xs text-muted-foreground"
          >
            No font matches “{query.trim()}”.
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * The entries for a use, as far as they match the search: the default, the
 * family the file names if it is not installed or not listed, then the
 * families, monospace ones first for code, each group by name.
 */
function fontEntries(
  use: FontUse,
  chosen: string | null,
  missing: string | undefined,
  fonts: FontList | undefined,
  query: string,
): Entry[] {
  const text = query.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(text);
  const entries: Entry[] = [];
  const shipped = shippedFonts[use].family;
  if (matches("Default") || matches(shipped))
    entries.push({ family: null, label: "Default", note: shipped });
  if (missing !== undefined && matches(missing))
    entries.push({
      family: missing,
      label: missing,
      note: "not installed",
      unavailable: true,
    });
  const families = fonts?.families ?? [];
  // Chosen while the families could not be listed.
  if (chosen !== null && !families.includes(chosen) && matches(chosen))
    entries.push({ family: chosen, label: chosen });
  const found = families.filter(matches);
  if (use === "interfaceFont") {
    for (const family of found) entries.push({ family, label: family });
    return entries;
  }
  const monospace = found.filter(isMonospace);
  const others = found.filter((family) => !isMonospace(family));
  monospace.forEach((family, index) => {
    entries.push({
      family,
      label: family,
      ...(index === 0 ? { heading: "Monospace" } : {}),
    });
  });
  others.forEach((family, index) => {
    entries.push({
      family,
      label: family,
      ...(index === 0 ? { heading: "Other fonts" } : {}),
    });
  });
  return entries;
}

/** What tells an entry apart: its family, and whether it is installed. */
function entryKey(entry: Entry): string {
  return `${entry.unavailable ? "missing" : "family"}:${entry.family ?? ""}`;
}
