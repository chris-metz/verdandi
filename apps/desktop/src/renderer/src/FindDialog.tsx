import { ArrowDown, ArrowUp, X } from "lucide-react";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  emptyFind,
  findText,
  followTextMatch,
  sameTextMatch,
  retainedTextMatch,
  textMatchKey,
  stepTextMatch,
  type FindState,
  type TextMatch,
} from "./find";
import {
  clearFindHighlights,
  findDetails,
  highlightFind,
  needsFindBubble,
  rangeOfTextMatch,
  readFindFields,
  revealTextDetails,
  revealFindField,
  type RenderedFindField,
} from "./find-dom";

interface FindSurface {
  reveal: (issueId: string) => void;
  open?: (
    issueId: string,
    transfer: NonNullable<FindState["transfer"]>,
  ) => void;
}
const FindContext = createContext<{
  open: boolean;
  register: (surface: FindSurface) => () => void;
}>({
  open: false,
  register: () => () => undefined,
});

/** A list/page supplies only its local reveal and, for lists, Return's destination. */
export function useFindSurface(surface: FindSurface): boolean {
  const { open, register } = useContext(FindContext);
  useLayoutEffect(() => register(surface), [register, surface]);
  return open;
}

interface FindDisplay {
  current: number;
  total: number;
  bubble?:
    | { text: string; start: number; end: number; left: number; top: number }
    | undefined;
}

/** A non-modal Find owned by the tab, over the content it already shows. */
export function Find({
  state = emptyFind,
  onChange,
  children,
}: {
  state: FindState | undefined;
  onChange: (state: FindState) => void;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const surface = useRef<FindSurface>(undefined);
  const seenDetails = useRef(new WeakSet<HTMLDetailsElement>());
  const scanned = useRef<{
    fields: RenderedFindField[];
    matches: TextMatch[];
    page: string;
    query: string;
  }>({ fields: [], matches: [], page: "", query: "" });
  const [display, setDisplay] = useState<FindDisplay>({ current: 0, total: 0 });
  const context = useMemo(
    () => ({
      open: state.open,
      register(value: FindSurface) {
        surface.current = value;
        return () => {
          if (surface.current === value) surface.current = undefined;
        };
      },
    }),
    [state.open],
  );
  const latest = useRef({ state, onChange });
  useLayoutEffect(() => {
    latest.current = { state, onChange };
  });

  function close() {
    const { state, onChange } = latest.current;
    onChange({ ...state, open: false });
    content.current
      ?.querySelector<HTMLElement>("[data-pane-focus]")
      ?.focus({ preventScroll: true });
  }
  function step(by: 1 | -1) {
    const { state, onChange } = latest.current;
    const active = stepTextMatch(scanned.current.matches, state.active, by);
    if (active) onChange({ ...state, active, revealed: undefined });
  }
  function enter(backward: boolean) {
    const { state } = latest.current;
    const { fields, matches } = scanned.current;
    const field = fields.find(({ key }) => key === state.active?.field);
    if (!field || !state.active) return;
    if (surface.current?.open) {
      const id =
        field.element.closest<HTMLElement>("[data-issue-id]")?.dataset.issueId;
      if (id)
        surface.current.open(id, {
          field: field.name,
          occurrence: matches
            .filter((match) => match.field === field.key)
            .findIndex((match) => sameTextMatch(match, state.active)),
        });
    } else step(backward ? -1 : 1);
  }

  useLayoutEffect(() => {
    if (state.open) {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    }
  }, [state.open, state.focus]);

  // Run after every commit, and for sanitized HTML/media which update outside React.
  // No debounce: the first character is as immediate as subsequent ones.
  useLayoutEffect(() => {
    const root = content.current;
    if (!root) return;
    function scan() {
      const { state, onChange } = latest.current;
      if (!root) return;
      const page =
        root.querySelector<HTMLElement>("[data-find-page]")?.dataset.findPage;
      // An unmounted/loading surface must not discard the tab's saved occurrence.
      if (!page) {
        clearFindHighlights();
        return;
      }
      const sections =
        state.open || state.details?.[page]
          ? findDetails(root, state.details?.[page] ?? {}, seenDetails.current)
          : new Map<string, HTMLDetailsElement>();
      const rememberSections = (next: FindState) => {
        if (sections.size === 0) return next;
        const details = Object.fromEntries(
          [...sections].map(([key, element]) => [key, element.open]),
        );
        return JSON.stringify(details) === JSON.stringify(state.details?.[page])
          ? next
          : { ...next, details: { ...state.details, [page]: details } };
      };
      if (!state.open) {
        clearFindHighlights();
        const next = rememberSections(state);
        if (next !== state) {
          onChange(next);
          latest.current = { state: next, onChange };
        }
        return;
      }
      const fields = readFindFields(root, state.query);
      const matches = findText(fields, state.query);
      const before = scanned.current;
      let active: TextMatch | undefined;
      if (state.page !== page || state.transfer) {
        const preferred =
          state.transfer &&
          fields.find(
            (field) =>
              field.name === state.transfer?.field &&
              field.element.closest("[data-find-primary]"),
          );
        const corresponding =
          preferred && matches.filter((match) => match.field === preferred.key);
        active =
          (corresponding && corresponding[state.transfer?.occurrence ?? 0]) ??
          corresponding?.[0] ??
          matches[0];
      } else if (before.query !== state.query && before.page === page)
        active = matches[0];
      else active = followTextMatch(before.matches, matches, state.active);
      scanned.current = { fields, matches, page, query: state.query };
      highlightFind(fields, matches, active);
      const field = fields.find(({ key }) => key === active?.field);
      const range = active && rangeOfTextMatch(fields, active);
      const key = textMatchKey(page, state.query, active);
      let revealed = active ? state.revealed : undefined;
      // A surviving occurrence shifted by an edit keeps its reading position.
      if (
        state.page === page &&
        revealed === textMatchKey(page, state.query, state.active) &&
        retainedTextMatch(matches, state.active)
      )
        revealed = key;
      if (field && active && key !== revealed) {
        const id =
          field.element.closest<HTMLElement>("[data-issue-id]")?.dataset
            .issueId;
        if (id) surface.current?.reveal(id);
        if (range) revealTextDetails(range);
        if (!field.element.closest("[hidden]")) {
          revealed = key;
          revealFindField(field, range);
        }
      }

      let nextState = rememberSections(state);
      if (
        state.page !== page ||
        !sameTextMatch(active, state.active) ||
        active?.text !== state.active?.text ||
        state.revealed !== revealed ||
        (state.transfer && active)
      ) {
        nextState = { ...nextState, page, active, revealed };
        if (active) delete nextState.transfer;
      }
      if (nextState !== state) {
        onChange(nextState);
        latest.current = { state: nextState, onChange };
      }
      let bubble: FindDisplay["bubble"];
      if (
        field &&
        active &&
        needsFindBubble(field, range) &&
        !field.element.closest("[hidden]")
      ) {
        const anchor = field.element.getBoundingClientRect();
        const bounds = root.getBoundingClientRect();
        if (anchor.bottom > bounds.top && anchor.top < bounds.bottom)
          bubble = {
            text: field.text,
            start: active.start,
            end: active.end,
            left: Math.max(
              bounds.left + 8,
              Math.min(anchor.left, bounds.right - 360),
            ),
            top: Math.max(
              bounds.top + 52,
              Math.min(anchor.bottom + 5, bounds.bottom - 208),
            ),
          };
      }
      const next = {
        current: active
          ? matches.findIndex((match) => sameTextMatch(match, active)) + 1
          : 0,
        total: matches.length,
        bubble,
      };
      setDisplay((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    }
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "data-find-text",
        "data-find-alternative",
        "data-find-page",
        "hidden",
        "open",
      ],
    });
    root.addEventListener("scroll", scan, true);
    window.addEventListener("resize", scan);
    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", scan, true);
      window.removeEventListener("resize", scan);
      clearFindHighlights();
    };
  });

  return (
    <FindContext.Provider value={context}>
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onKeyDownCapture={(event) => {
          if (state.open && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <div ref={content} className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
        {state.open && (
          <div
            role="dialog"
            aria-label="Find in current content"
            className="absolute top-1 right-3 z-30 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg"
          >
            <input
              ref={input}
              aria-label="Find text"
              placeholder="Find in loaded content"
              value={state.query}
              className="min-w-0 w-52 rounded border bg-background px-2 py-1 text-sm outline-none focus:border-ring"
              onChange={(event) => {
                onChange({
                  ...state,
                  query: event.target.value,
                  active: undefined,
                  transfer: undefined,
                });
              }}
              onKeyDown={(event) => {
                if (
                  event.nativeEvent.isComposing ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.altKey
                )
                  return;
                if (["ArrowUp", "ArrowDown", "Enter"].includes(event.key)) {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.key === "Enter") enter(event.shiftKey);
                  else step(event.key === "ArrowUp" ? -1 : 1);
                }
              }}
            />
            <span
              role="status"
              aria-live="polite"
              title="Text matches in loaded content"
              className="min-w-12 px-1 text-center text-xs text-muted-foreground tabular-nums"
            >
              {display.current}/{display.total}
            </span>
            <FindButton
              label="Previous text match"
              disabled={display.total === 0}
              onClick={() => {
                step(-1);
              }}
            >
              <ArrowUp className="size-4" />
            </FindButton>
            <FindButton
              label="Next text match"
              disabled={display.total === 0}
              onClick={() => {
                step(1);
              }}
            >
              <ArrowDown className="size-4" />
            </FindButton>
            <FindButton label="Close Find" onClick={close}>
              <X className="size-4" />
            </FindButton>
          </div>
        )}
        {state.open && display.bubble && (
          <div
            data-find-ignore
            className="pointer-events-none fixed z-40 max-h-48 w-max max-w-88 overflow-auto rounded-md border bg-popover px-3 py-2 text-sm wrap-anywhere whitespace-pre-wrap text-popover-foreground shadow-md"
            style={{ left: display.bubble.left, top: display.bubble.top }}
          >
            {display.bubble.text.slice(0, display.bubble.start)}
            <mark className="find-active-mark">
              {display.bubble.text.slice(
                display.bubble.start,
                display.bubble.end,
              )}
            </mark>
            {display.bubble.text.slice(display.bubble.end)}
          </div>
        )}
      </div>
    </FindContext.Provider>
  );
}

function FindButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
      className="rounded p-1.5 hover:bg-accent disabled:opacity-35"
    >
      {children}
    </button>
  );
}
