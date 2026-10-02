import type {
  IssueLookup,
  RecentIssue,
  RepositoryAddress,
} from "@verdandi/core/contract";
import {
  ArrowRight,
  CornerDownLeft,
  Hash,
  History,
  LoaderCircle,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { qualifiedReference } from "@verdandi/core/repository-address";
import {
  afterLookUp,
  goToChoices,
  recentIssueOf,
  type GoToDestination,
  type GoToIssueStatus,
} from "./go-to-issue";
import { showNotice } from "./Notices";
import { problemText } from "./problem-text";
import { repositoryLabel } from "./scope";

/**
 * Go to Issue: a field that takes `#12`, `owner/name#12`, `owner/name 12`
 * or a link to an issue on GitHub, and below it the issue typed, then the
 * recent issues matching what is typed, by title or `owner/name#12`. ↑/↓
 * choose, ↩ opens, and Esc clears the field, or, once it is empty, is left
 * to what holds the palette. A recent issue opens at once; any other is
 * looked up on GitHub first, and the palette says why one cannot open. A
 * pull request's number opens it on GitHub instead, with a notice.
 */
export function GoToIssuePalette({
  from,
  login,
  inline,
  hasKeyboard = true,
  onChoose,
}: {
  /** The repository a bare `#12` names, if any. */
  from: RepositoryAddress | undefined;
  /** The account GitHub is read as, if known, to name it when unavailable. */
  login: string | undefined;
  /** Whether it stands in a new tab, rather than in a dialog. */
  inline: boolean;
  /** Whether it has the keyboard, which its field then holds. */
  hasKeyboard?: boolean;
  /** Opens an issue chosen. */
  onChoose: (issue: RecentIssue) => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [recents, setRecents] = useState<RecentIssue[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const [status, setStatus] = useState<GoToIssueStatus>({ kind: "idle" });
  // Counts the lookups started, so that an answer to one dropped by new
  // text, or by closing the palette, does nothing.
  const lookups = useRef(0);
  useEffect(
    () => () => {
      lookups.current++;
    },
    [],
  );
  useEffect(() => {
    let current = true;
    window.verdandi.getRecentIssues().then(
      (issues) => {
        if (current) setRecents(issues);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (hasKeyboard) field.current?.focus({ preventScroll: true });
  }, [hasKeyboard]);

  const { destinations, hint } = goToChoices(text, { from, recents });
  const current = Math.min(highlighted, Math.max(destinations.length - 1, 0));
  const firstRecent = destinations.findIndex(({ kind }) => kind === "recent");

  function type(next: string) {
    setText(next);
    setHighlighted(0);
    setStatus({ kind: "idle" });
    lookups.current++;
  }

  async function go(destination = destinations[current]) {
    if (!destination || status.kind === "looking-up") return;
    if (destination.kind === "recent") {
      onChoose(destination.issue);
      return;
    }
    const reference = qualifiedReference(
      destination.repository,
      destination.number,
    );
    const lookup = ++lookups.current;
    setStatus({ kind: "looking-up", reference });
    let found: IssueLookup;
    try {
      found = await window.verdandi.lookUpIssue(
        destination.repository,
        destination.number,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      found = { status: "failed", problem: { kind: "error", message } };
    }
    if (lookup !== lookups.current) return;
    const next = afterLookUp(found);
    switch (next.kind) {
      case "open": {
        setStatus({ kind: "idle" });
        // Its link names where it lives now, also once it has moved.
        const issue = recentIssueOf(next.issue, undefined);
        if (issue) onChoose(issue);
        return;
      }
      case "pull-request":
        window.desktop.openExternal(next.url);
        showNotice({ kind: "pull-request-opened", reference });
        type("");
        return;
      default:
        setStatus(next);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const count = destinations.length;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (count > 0)
          setHighlighted(
            (current + (event.key === "ArrowDown" ? 1 : -1) + count) % count,
          );
        break;
      case "Enter":
        event.preventDefault();
        void go();
        break;
      case "Escape":
        if (text === "") break;
        // Only the field is cleared, also of a lookup under way.
        event.preventDefault();
        event.stopPropagation();
        type("");
        break;
    }
  }

  return (
    <div className="flex flex-col">
      <label
        className={cn(
          "flex items-center gap-3 rounded-xl border bg-card px-4 focus-within:ring-3 focus-within:ring-ring/40",
          inline ? "h-14 shadow-sm" : "h-12",
        )}
      >
        <Hash aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <input
          ref={field}
          data-pane-focus
          value={text}
          aria-label="Go to Issue"
          placeholder={
            from
              ? `#12 in ${repositoryLabel(from)}, owner/name#12 or a link`
              : "owner/name#12 or a link to an issue"
          }
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            type(event.target.value);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground",
            inline && "text-lg",
          )}
        />
        {status.kind === "looking-up" && (
          <LoaderCircle
            aria-hidden
            className="size-4 shrink-0 animate-spin text-muted-foreground"
          />
        )}
      </label>
      <StatusLine status={status} hint={hint} login={login} />
      <div role="listbox" aria-label="Issues to go to" className="mt-2">
        {destinations.map((destination, index) => (
          <div key={destinationKey(destination)}>
            {index === firstRecent && (
              <div className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
                Recent
              </div>
            )}
            <DestinationRow
              destination={destination}
              highlighted={index === current}
              onHover={() => {
                setHighlighted(index);
              }}
              onGo={() => void go(destination)}
            />
          </div>
        ))}
        {recents.length === 0 && text.trim() === "" && (
          <p className="px-3 py-6 text-center text-muted-foreground">
            The issues you open appear here.
          </p>
        )}
      </div>
      <div
        className={cn(
          "flex justify-center gap-4 text-xs text-muted-foreground",
          inline ? "mt-6" : "mt-3",
        )}
      >
        <KeyHint keys="↑↓">Choose</KeyHint>
        <KeyHint keys="↩">Open</KeyHint>
        <KeyHint keys="Esc">
          {inline || text !== "" ? "Clear" : "Close"}
        </KeyHint>
      </div>
    </div>
  );
}

function destinationKey(destination: GoToDestination): string {
  return destination.kind === "recent"
    ? destination.issue.id
    : `look-up:${qualifiedReference(destination.repository, destination.number)}`;
}

/** One issue the palette offers: the issue typed, or a recent issue. */
function DestinationRow({
  destination,
  highlighted,
  onHover,
  onGo,
}: {
  destination: GoToDestination;
  highlighted: boolean;
  onHover: () => void;
  onGo: () => void;
}) {
  const typed = destination.kind === "look-up";
  const { repository, number } = typed ? destination : destination.issue;
  return (
    <div
      role="option"
      aria-selected={highlighted}
      onMouseMove={onHover}
      onClick={onGo}
      className={cn(
        "flex h-9 cursor-default items-center gap-3 rounded-lg px-3",
        highlighted && "bg-selection",
      )}
    >
      {typed ? (
        <ArrowRight aria-hidden className="size-4 shrink-0 text-primary" />
      ) : (
        <History
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      )}
      <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        #{number}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {typed ? (
          <>
            Go to{" "}
            <span className="font-medium">
              {qualifiedReference(repository, number)}
            </span>
          </>
        ) : (
          destination.issue.title
        )}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {repositoryLabel(repository)}
      </span>
      <CornerDownLeft
        aria-hidden
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground",
          !highlighted && "invisible",
        )}
      />
    </div>
  );
}

/** What the palette says under its field, if anything. */
function StatusLine({
  status,
  hint,
  login,
}: {
  status: GoToIssueStatus;
  hint: string | undefined;
  login: string | undefined;
}) {
  switch (status.kind) {
    case "looking-up":
      return (
        <p role="status" className="px-3 pt-2 text-xs text-muted-foreground">
          Looking up {status.reference}…
        </p>
      );
    case "failed": {
      const { text, detail, link } = problemText(status.problem, login);
      return (
        <div role="alert" className="space-y-1 px-3 pt-2 text-xs">
          <p className="break-words text-destructive">{text}</p>
          {detail !== undefined && (
            <p className="break-words text-muted-foreground">{detail}</p>
          )}
          {link && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                window.desktop.openExternal(link.url);
              }}
            >
              {link.label}
            </Button>
          )}
        </div>
      );
    }
    case "idle":
      return hint === undefined ? null : (
        <p role="status" className="px-3 pt-2 text-xs text-muted-foreground">
          {hint}
        </p>
      );
  }
}

function KeyHint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border bg-muted px-1 font-sans text-[11px]">
        {keys}
      </kbd>
      {children}
    </span>
  );
}

/**
 * The Go to Issue dialog over the tab shown, which `#` and its header
 * button open: the palette, whose issue chosen opens in that tab. Esc with
 * the field empty closes it, also while GitHub is being asked.
 */
export function GoToIssueDialog({
  from,
  login,
  onChoose,
  refocusPane,
  onClose,
}: {
  /** The repository a bare `#12` names: the tab's, if it shows one. */
  from: RepositoryAddress | undefined;
  login: string | undefined;
  /** Opens an issue chosen, closing the dialog. */
  onChoose: (issue: RecentIssue) => void;
  /** Gives the pane that had the keyboard it again, once the dialog is gone. */
  refocusPane: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={() => {
          // Base UI otherwise prefers the pane's first tabbable child, or
          // the list the dialog was opened from, which an issue page may
          // have replaced.
          queueMicrotask(refocusPane);
          return false;
        }}
        className="top-[12vh] translate-y-0 gap-0 p-3 sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">Go to Issue</DialogTitle>
        <GoToIssuePalette
          from={from}
          login={login}
          inline={false}
          onChoose={onChoose}
        />
      </DialogContent>
    </Dialog>
  );
}

/** The header button that opens the Go to Issue dialog, as `#` does. */
export function GoToIssueButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Go to Issue"
      title="Go to Issue (#)"
      // The keyboard stays where it was, to return there as the dialog closes.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Hash aria-hidden className="size-3.5" />
    </button>
  );
}
