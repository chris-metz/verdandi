import type {
  IssueLookup,
  IssueNode,
  RepositoryAddress,
} from "@verdandi/core/contract";
import { Hash } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  afterLookUp,
  beforeLookUp,
  issueNumber,
  type GoToIssueStatus,
} from "./go-to-issue";
import type { IssueDestination } from "./issue-navigation";
import { problemText } from "./problem-text";
import { repositoryLabel } from "./scope";

/**
 * The Go to issue dialog: the number of an issue in a tracked repository,
 * typed after its `owner/name #`, whose page ↵ opens. An issue the
 * repository's list has opens at once, and the issue already shown just
 * closes the dialog; any other is looked up on GitHub first. When it cannot
 * open, the dialog stays open with the number and
 * says why; for a pull request, ↵ opens its page on GitHub instead. Esc
 * closes it, also while GitHub is being asked.
 */
export function GoToIssueDialog({
  repository,
  login,
  shown,
  trees,
  onOpen,
  refocusPane,
  onClose,
}: {
  repository: RepositoryAddress;
  /** The account GitHub is read as, if known, to name it when unavailable. */
  login: string | undefined;
  /** The issue page on screen, if any. */
  shown: IssueDestination | undefined;
  /** The trees of the repository's list as last pushed, as ↵ reads them. */
  trees: () => readonly IssueNode[];
  /** Opens an issue's page, closing the dialog. */
  onOpen: (issue: IssueDestination) => void;
  /** Gives the pane that had the keyboard it again, once the dialog is gone. */
  refocusPane: () => void;
  onClose: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<GoToIssueStatus>({ kind: "idle" });
  // Counts the lookups started, so that an answer to one dropped by a new
  // number, or by closing the dialog, does nothing.
  const lookups = useRef(0);
  useEffect(
    () => () => {
      lookups.current++;
    },
    [],
  );

  /** Opens a pull request's page, which Verdandi does not show, instead. */
  function openOnGitHub(url: string) {
    window.desktop.openExternal(url);
    onClose();
  }

  async function submit() {
    switch (status.kind) {
      case "looking-up":
        return;
      case "pull-request":
        openOnGitHub(status.url);
        return;
    }
    const number = issueNumber(text);
    if (number === undefined) {
      setStatus({ kind: "invalid" });
      return;
    }
    const step = beforeLookUp(number, { repository, shown, trees: trees() });
    switch (step.kind) {
      case "shown":
        onClose();
        return;
      case "open":
        onOpen(step.issue);
        return;
    }
    const lookup = ++lookups.current;
    setStatus({ kind: "looking-up", number });
    let found: IssueLookup;
    try {
      found = await window.verdandi.lookUpIssue(repository, number);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      found = { status: "failed", problem: { kind: "error", message } };
    }
    if (lookup !== lookups.current) return;
    const next = afterLookUp(found, number);
    if (next.kind === "open") onOpen(next.issue);
    else setStatus(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void submit();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={field}
        finalFocus={() => {
          // Base UI otherwise prefers the pane's first tabbable child, or
          // the list the dialog was opened from, which an issue page may
          // have replaced.
          queueMicrotask(refocusPane);
          return false;
        }}
        className="gap-3"
      >
        <div className="flex items-center justify-between">
          <DialogTitle>Go to issue</DialogTitle>
          <kbd className="rounded border border-b-2 px-1 font-mono text-[11px] text-muted-foreground">
            Esc
          </kbd>
        </div>
        <label className="flex h-8 items-center rounded-md border bg-background px-2.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <span className="min-w-0 truncate text-muted-foreground">
            {repositoryLabel(repository)}
          </span>
          <span className="shrink-0 pr-1 pl-1.5 text-muted-foreground">#</span>
          <input
            ref={field}
            value={text}
            aria-label={`Issue number in ${repositoryLabel(repository)}`}
            inputMode="numeric"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setText(event.target.value);
              setStatus({ kind: "idle" });
              lookups.current++;
            }}
            onKeyDown={onKeyDown}
            className="min-w-16 flex-1 bg-transparent outline-none"
          />
        </label>
        <StatusLine
          status={status}
          login={login}
          onOpenOnGitHub={openOnGitHub}
        />
      </DialogContent>
    </Dialog>
  );
}

/** What the dialog says under its field, if anything. */
function StatusLine({
  status,
  login,
  onOpenOnGitHub,
}: {
  status: GoToIssueStatus;
  login: string | undefined;
  onOpenOnGitHub: (url: string) => void;
}) {
  switch (status.kind) {
    case "idle":
      return null;
    case "invalid":
      return (
        <p role="alert" className="text-xs text-destructive">
          Type an issue number
        </p>
      );
    case "looking-up":
      return (
        <p role="status" className="text-xs text-muted-foreground">
          Looking up #{status.number}…
        </p>
      );
    case "pull-request":
      return (
        <div role="status" className="flex items-center gap-2 text-xs">
          <span className="flex-1">#{status.number} is a pull request</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onOpenOnGitHub(status.url);
            }}
          >
            Open on GitHub
          </Button>
        </div>
      );
    case "failed": {
      const { text, detail, link } = problemText(status.problem, login);
      return (
        <div role="alert" className="space-y-1 text-xs">
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
  }
}

/** The header button that opens the Go to issue dialog, as `#` does. */
export function GoToIssueButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Go to issue"
      title="Go to issue (#)"
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
