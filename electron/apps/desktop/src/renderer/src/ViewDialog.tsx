import type {
  Problem,
  RepositoryAddress,
  SavedView,
} from "@verdandi/core/contract";
import { Info, TriangleAlert } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ShortcutModifier } from "./pane-navigation";
import { problemText } from "./problem-text";
import {
  applyExample,
  dialogStart,
  scopeLine,
  viewExamples,
  type ViewDialogPurpose,
} from "./view-dialog";

/** Why the dialog could not save, as Save last found. */
type Outcome =
  | { kind: "rejected"; message: string }
  | { kind: "unchecked"; problem: Problem }
  | { kind: "failed"; message: string };

const field =
  "h-line-8 rounded-md border bg-background px-2.5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * The dialog that creates a view, edits one or duplicates one: its name and
 * GitHub search,
 * a line saying what the search covers, and examples. Save runs the search
 * once and saves only what GitHub accepts; when it cannot be run, the view
 * can be saved anyway. ↵ in the search field or ⌘/Ctrl+↵ saves, Esc
 * cancels.
 */
export function ViewDialog({
  purpose,
  tracked,
  removable,
  modifier,
  onSaved,
  onRemove,
  onClose,
}: {
  /** A new view, the view to edit, or the view to duplicate. */
  purpose: ViewDialogPurpose;
  /** The tracked repositories, which the examples name. */
  tracked: readonly RepositoryAddress[];
  /** Whether the view can be removed, which it cannot while settings are read-only. */
  removable: boolean;
  modifier: ShortcutModifier;
  onSaved: (view: SavedView) => void;
  /** Asks to remove the view being edited. */
  onRemove: () => void;
  onClose: () => void;
}) {
  const [start] = useState(() => dialogStart(purpose));
  const [name, setName] = useState(start.name);
  const [query, setQuery] = useState(start.query);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const nameField = useRef<HTMLInputElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const examples = useMemo(() => viewExamples(tracked), [tracked]);
  const scope = scopeLine(query);

  async function save(force = false) {
    if (busy) return;
    setBusy(true);
    setOutcome(undefined);
    try {
      const result = await window.verdandi.saveView(
        { ...start.draft, name, query },
        { force },
      );
      switch (result.status) {
        case "saved":
          onSaved(result.view);
          return;
        case "rejected":
          setOutcome({ kind: "rejected", message: result.message });
          break;
        case "unchecked":
          setOutcome({ kind: "unchecked", problem: result.problem });
          break;
        case "failed":
          setOutcome({ kind: "failed", message: result.message });
          break;
      }
    } catch (error) {
      setOutcome({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    setBusy(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter") return;
    if (
      modifier.isHeld(event) ||
      (event.target === searchField.current && !event.shiftKey)
    ) {
      event.preventDefault();
      void save();
    } else if (event.target === nameField.current) {
      event.preventDefault();
      searchField.current?.focus();
    }
  }

  return (
    <Dialog
      open
      disablePointerDismissal={busy}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={() => {
          if (start.focus === "search") return searchField.current;
          // A duplicate's name is there to be typed over.
          nameField.current?.focus();
          nameField.current?.select();
          return false;
        }}
        onKeyDown={onKeyDown}
        className="flex max-h-[calc(100%-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <DialogTitle>{start.title}</DialogTitle>
          <kbd className="rounded border border-b-2 px-1 font-mono text-2xs text-muted-foreground">
            Esc
          </kbd>
        </div>
        <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto px-4 pb-4">
          <label htmlFor="view-name" className="text-xs font-medium">
            Name
          </label>
          <input
            id="view-name"
            ref={nameField}
            value={name}
            placeholder="Open bugs"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
            }}
            className={field}
          />
          <label htmlFor="view-search" className="mt-2 text-xs font-medium">
            GitHub search
          </label>
          <input
            id="view-search"
            ref={searchField}
            value={query}
            placeholder="is:open label:bug"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setOutcome(undefined);
            }}
            className={cn(
              field,
              "font-mono text-[calc(13px*var(--text-scale))]",
            )}
          />
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>{scope.text}</span>
          </p>
          {scope.warning && (
            <p
              role="status"
              className="flex items-start gap-1.5 text-xs text-warning"
            >
              <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>{scope.warning}</span>
            </p>
          )}
          {outcome && (
            <SaveProblem
              outcome={outcome}
              busy={busy}
              onSaveAnyway={() => {
                void save(true);
              }}
              onTryAgain={() => {
                void save();
              }}
            />
          )}
          <p className="mt-3 text-xs font-medium">
            Examples{" "}
            <span className="font-normal text-muted-foreground">
              click one to use it
            </span>
          </p>
          <ul className="divide-y overflow-hidden rounded-md border">
            {examples.map((example) => (
              <li key={example.query}>
                <button
                  type="button"
                  onClick={() => {
                    const applied = applyExample(
                      { name, query },
                      example,
                      examples,
                    );
                    setName(applied.name);
                    setQuery(applied.query);
                    setOutcome(undefined);
                    searchField.current?.focus();
                  }}
                  className="grid w-full grid-cols-[minmax(0,20rem)_1fr] items-center gap-3 px-2.5 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <code className="truncate font-mono text-xs">
                    {example.query}
                  </code>
                  <span className="text-xs text-muted-foreground">
                    {example.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter className="m-0 items-center">
          {purpose.kind === "edit" && (
            <Button
              variant="destructive"
              disabled={busy || !removable}
              onClick={onRemove}
              className="sm:mr-auto"
            >
              Remove view…
            </Button>
          )}
          <span role="status" className="text-xs text-muted-foreground">
            {busy ? "Checking with GitHub…" : "Save runs the search once"}
          </span>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void save();
            }}
          >
            Save
            <kbd className="font-mono text-2xs opacity-70">
              {modifier.label("↵")}
            </kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Why Save did not save, and what can be done about it. */
function SaveProblem({
  outcome,
  busy,
  onSaveAnyway,
  onTryAgain,
}: {
  outcome: Outcome;
  busy: boolean;
  onSaveAnyway: () => void;
  onTryAgain: () => void;
}) {
  const box = "mt-2 rounded-md border border-destructive/40 p-2.5 text-xs";
  switch (outcome.kind) {
    case "rejected":
      return (
        <div role="alert" className={box}>
          <p className="font-medium">GitHub rejected this search</p>
          <pre className="mt-1.5 font-mono whitespace-pre-wrap">
            {outcome.message}
          </pre>
        </div>
      );
    case "failed":
      return (
        <p role="alert" className="text-xs break-words text-destructive">
          {outcome.message}
        </p>
      );
    case "unchecked": {
      const { text, detail } = problemText(outcome.problem);
      return (
        <div role="alert" className={box}>
          <p className="font-medium">
            {outcome.problem.kind === "unreachable"
              ? "Couldn’t reach GitHub to check this search"
              : "GitHub returned an error while checking this search"}
          </p>
          <p className="mt-1 text-muted-foreground">
            {[text, detail].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onSaveAnyway}
            >
              Save anyway
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onTryAgain}
            >
              Try again
            </Button>
          </div>
        </div>
      );
    }
  }
}
