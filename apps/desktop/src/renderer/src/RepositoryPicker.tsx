import type {
  PickerRepository,
  RepositorySuggestions,
} from "@verdandi/core/contract";
import {
  parseRepositoryInput,
  repositoryKey,
  sameRepository,
} from "@verdandi/core/repository-address";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ProblemNotice } from "./ProblemNotice";
import {
  afterAdding,
  cycleFilter,
  filtersOf,
  pickerRows,
  restrictionText,
  sameFilter,
  toggled,
  type DirectCheck,
  type PickerFilter,
  type PickerRow,
  type RowNote,
} from "./repository-picker";

/** How long typing pauses before an exact address is checked, in ms. */
const checkAfter = 250;

/** Suggestions before the first push: loading, with nothing yet. */
const noSuggestions: RepositorySuggestions = {
  owners: [],
  repositories: [],
  loading: { status: "loading" },
  restrictions: [],
  incomplete: false,
};

/**
 * The repository picker: the account and its organizations on the left, as
 * filters; their suggested repositories on the right, with checkboxes. The
 * input keeps the keyboard: typing filters, an exact `owner/name` or URL is
 * checked directly, ↑/↓ move, Space toggles, Tab cycles the filters, and
 * Enter adds. Repositories that could not be added stay checked, each with
 * why; once every one is added, the picker closes. On first launch, it
 * offers **Skip**, which keeps it from opening on its own again; closed any
 * other way, it opens again on the next launch.
 */
export function RepositoryPicker({
  firstLaunch,
  settingsProblem,
  login,
  onClose,
}: {
  /** Whether no settings file exists yet, so that closing it skips. */
  firstLaunch: boolean;
  /** Why repositories cannot be added, while the settings file says so. */
  settingsProblem: string | undefined;
  /** The account GitHub is read as, if known. */
  login: string | undefined;
  onClose: () => void;
}) {
  const suggestions = useSuggestions();
  const [filter, setFilter] = useState<PickerFilter>({ kind: "all" });
  const [text, setText] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<Map<number, PickerRepository>>(
    () => new Map(),
  );
  const [errors, setErrors] = useState<Map<number, RowNote>>(() => new Map());
  const direct = useDirectCheck(text, suggestions);
  const [overrides, setOverrides] = useState<Map<number, PickerRepository>>(
    () => new Map(),
  );
  const [busy, setBusy] = useState<"adding" | "skipping">();
  const [failure, setFailure] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const filters = useMemo(() => filtersOf(suggestions), [suggestions]);
  const rows = useMemo(
    () =>
      pickerRows({
        suggestions,
        filter,
        text,
        direct: withOverrides(direct, overrides),
        selected,
        errors,
        login,
      }),
    [suggestions, filter, text, direct, overrides, selected, errors, login],
  );
  const cursor = Math.min(highlight, Math.max(rows.length - 1, 0));

  // What the keyboard is on stays in sight.
  useLayoutEffect(() => {
    list.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor, rows]);

  function toggle(row: PickerRow | undefined) {
    if (!row || row.disabled) return;
    setSelected((current) => toggled(current, row));
    if (row.candidate) {
      const { id } = row.candidate;
      setErrors((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    }
  }

  async function add() {
    if (busy || settingsProblem !== undefined) return;
    const highlighted = rows[cursor];
    const chosen =
      selected.size > 0
        ? [...selected.values()]
        : highlighted && !highlighted.disabled && highlighted.candidate
          ? [highlighted.candidate]
          : [];
    if (chosen.length === 0) return;
    setBusy("adding");
    setFailure(undefined);
    try {
      const additions = await window.verdandi.addRepositories(
        chosen.map(({ repository }) => repository),
      );
      const after = afterAdding(chosen, additions, { selected, errors }, login);
      if (after.selected.size === 0) {
        onClose();
        return;
      }
      setSelected(after.selected);
      setErrors(after.errors);
      setOverrides(new Map([...overrides, ...after.added]));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  /** **Skip**: creates the empty settings file, so that it does not return. */
  async function skip() {
    if (busy) return;
    setBusy("skipping");
    setFailure(undefined);
    try {
      const result = await window.verdandi.skipRepositoryPicker();
      if (result.ok) onClose();
      else setFailure(result.message);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case "ArrowDown":
        setHighlight(Math.min(cursor + 1, rows.length - 1));
        break;
      case "ArrowUp":
        setHighlight(Math.max(cursor - 1, 0));
        break;
      case " ":
        toggle(rows[cursor]);
        break;
      case "Tab":
        setFilter(cycleFilter(filters, filter, event.shiftKey ? -1 : 1));
        setHighlight(0);
        break;
      case "Enter":
        void add();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const loading = suggestions.loading;
  const count = selected.size;
  const unsuggested = rows.length === 0 && loading.status !== "failed";

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        // Closed any other way, it opens again on the next first launch.
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton
        initialFocus={input}
        className="flex h-[min(40rem,calc(100%-3rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <header className="flex flex-col gap-1 border-b px-5 pt-4 pb-3">
          <DialogTitle className="text-base font-semibold">
            Add repositories
          </DialogTitle>
          <DialogDescription>
            Track repositories whose issues you can read. Type{" "}
            <span className="font-mono text-xs">owner/name</span> or paste a
            GitHub URL for any repository not suggested.
          </DialogDescription>
          <input
            ref={input}
            value={text}
            aria-label="Filter repositories, or type owner/name or a URL"
            placeholder="Filter, or type owner/name or a URL"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setText(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            className="mt-2 h-8 rounded-md border bg-background px-2.5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </header>
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Owners"
            className="w-48 shrink-0 overflow-y-auto border-r bg-muted/30 p-2"
          >
            <ul
              role="listbox"
              aria-label="Owners"
              className="flex flex-col gap-px"
            >
              {filters.map((option) => {
                const chosen = sameFilter(option, filter);
                return (
                  <li
                    key={option.kind === "all" ? "" : option.login}
                    role="option"
                    aria-selected={chosen}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      setFilter(option);
                      setHighlight(0);
                    }}
                    className={cn(
                      "truncate rounded-md px-2 py-1 select-none",
                      chosen
                        ? "bg-selection shadow-[inset_2px_0_0_var(--selection-edge)]"
                        : "hover:bg-muted",
                    )}
                  >
                    {filterLabel(option, suggestions)}
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            <SuggestionsStatus
              suggestions={suggestions}
              login={login}
              empty={unsuggested && loading.status === "loaded"}
            />
            <ul
              ref={list}
              role="listbox"
              aria-label="Suggested repositories"
              aria-multiselectable
              className="min-h-0 flex-1 overflow-y-auto p-2"
            >
              {rows.map((row, index) => (
                <Row
                  key={row.key}
                  row={row}
                  highlighted={index === cursor}
                  onToggle={() => {
                    setHighlight(index);
                    toggle(row);
                  }}
                />
              ))}
            </ul>
          </div>
        </div>
        <DialogFooter className="mx-0 mb-0 items-center px-5 py-3 sm:justify-between">
          <p
            role={failure || settingsProblem ? "alert" : undefined}
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              failure || settingsProblem
                ? "text-destructive"
                : "text-muted-foreground",
            )}
            title={failure ?? settingsProblem}
          >
            {failure ??
              settingsProblem ??
              `Space selects · Tab switches owner · Enter adds${count > 0 ? ` · ${String(count)} selected` : ""}`}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy !== undefined}
              onClick={() => {
                if (firstLaunch) void skip();
                else onClose();
              }}
            >
              {firstLaunch ? "Skip" : "Cancel"}
            </Button>
            <Button
              disabled={
                busy !== undefined ||
                settingsProblem !== undefined ||
                (count === 0 && !(rows[cursor] && !rows[cursor].disabled))
              }
              onClick={() => {
                void add();
              }}
            >
              {busy === "adding"
                ? "Adding…"
                : count > 1
                  ? `Add ${String(count)} repositories`
                  : "Add repository"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** How the left pane names a filter. */
function filterLabel(
  filter: PickerFilter,
  suggestions: RepositorySuggestions,
): string {
  if (filter.kind === "all") return "All suggestions";
  const owner = suggestions.owners.find(({ login }) =>
    sameFilter(filter, { kind: "owner", login }),
  );
  return owner?.kind === "account" ? `@${filter.login}` : filter.login;
}

/**
 * What the right pane says above its rows: that suggestions are loading,
 * that none were found, that they could not be read with Retry, that there
 * are more than it lists, and the restrictions GitHub named.
 */
function SuggestionsStatus({
  suggestions: { loading, repositories, restrictions, incomplete },
  login,
  empty,
}: {
  suggestions: RepositorySuggestions;
  login: string | undefined;
  /** Whether nothing is listed although every suggestion has loaded. */
  empty: boolean;
}) {
  const notes: React.ReactNode[] = [];
  if (loading.status === "loading") {
    notes.push(
      <p key="loading" className="text-muted-foreground">
        Loading suggestions…
        {repositories.length > 0 && ` ${String(repositories.length)} so far`}
      </p>,
    );
  }
  if (loading.status === "failed") {
    notes.push(
      <ProblemNotice
        key="failed"
        problem={loading.problem}
        login={login}
        subject="Suggestions"
        url={undefined}
        onRetry={() => {
          void window.verdandi.openRepositoryPicker();
        }}
      />,
    );
  }
  if (empty) {
    notes.push(
      <div key="empty">
        <p className="font-medium">No suggestions found</p>
        <p className="text-xs text-muted-foreground">
          Suggestions list only repositories GitHub shows as yours or your
          organizations&apos;. Type owner/name to add any other.
        </p>
      </div>,
    );
  }
  if (loading.status === "loaded" && loading.capped) {
    notes.push(
      <p key="capped" className="text-xs text-muted-foreground">
        Showing the {repositories.length.toLocaleString("en")} most recently
        pushed repositories. Type owner/name for others.
      </p>,
    );
  }
  if (incomplete && restrictions.length === 0) {
    notes.push(
      <p key="incomplete" className="text-xs text-muted-foreground">
        GitHub left some repositories out of its answer without saying why. Type
        owner/name to add one.
      </p>,
    );
  }
  for (const restriction of restrictions) {
    const note = restrictionText(restriction);
    notes.push(
      <p
        key={`${restriction.kind}:${restriction.message}`}
        title={note.detail}
        className="text-xs text-muted-foreground"
      >
        {note.text} {note.link && <NoteLink link={note.link} />}
      </p>,
    );
  }
  if (notes.length === 0) return null;
  return <div className="flex flex-col gap-2 border-b px-4 py-3">{notes}</div>;
}

/** A repository with its checkbox, and what keeps it from being toggled. */
function Row({
  row,
  highlighted,
  onToggle,
}: {
  row: PickerRow;
  highlighted: boolean;
  onToggle: () => void;
}) {
  const { owner, name } = row.repository;
  return (
    <li
      role="option"
      aria-selected={row.checked}
      aria-disabled={row.disabled}
      data-highlighted={highlighted}
      title={row.note?.detail}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onToggle}
      className={cn(
        "flex min-h-8 items-center gap-2.5 rounded-md px-2 py-1 select-none",
        highlighted &&
          "bg-selection shadow-[inset_2px_0_0_var(--selection-edge)]",
        !highlighted && !row.disabled && "hover:bg-muted",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded border",
          row.checked && "border-primary bg-primary text-primary-foreground",
          row.disabled && "opacity-50",
        )}
      >
        {row.checked && (
          <svg
            viewBox="0 0 16 16"
            className="size-3 fill-none stroke-current stroke-2"
          >
            <path d="m3.5 8.5 3 3 6-7" />
          </svg>
        )}
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          row.disabled && !row.checked && "text-muted-foreground",
        )}
      >
        <span className="text-muted-foreground">{owner}/</span>
        <span className="font-medium">{name}</span>
      </span>
      {row.archived && (
        <span className="shrink-0 rounded-full border px-1.5 text-[11px] text-muted-foreground">
          Archived
        </span>
      )}
      {row.note && (
        <span
          className={cn(
            "ml-auto min-w-0 truncate pl-2 text-xs",
            row.failed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {row.note.text}
          {row.note.link && (
            <>
              {" "}
              <NoteLink link={row.note.link} />
            </>
          )}
        </span>
      )}
    </li>
  );
}

function NoteLink({ link }: { link: { label: string; url: string } }) {
  return (
    <a
      href={link.url}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        window.desktop.openExternal(link.url);
      }}
      className="text-selection-edge underline-offset-2 hover:underline"
    >
      {link.label} ↗
    </a>
  );
}

/**
 * The picker's suggestions as the core pushes them: it is opened as the
 * picker mounts, and closed as it goes.
 */
function useSuggestions(): RepositorySuggestions {
  const [suggestions, setSuggestions] =
    useState<RepositorySuggestions>(noSuggestions);
  useEffect(() => {
    const unsubscribe = window.verdandi.on(
      "repositorySuggestionsChanged",
      setSuggestions,
    );
    void window.verdandi.openRepositoryPicker();
    return () => {
      unsubscribe();
      void window.verdandi.closeRepositoryPicker();
    };
  }, []);
  return suggestions;
}

/**
 * The check of the exact address typed, once typing pauses, unless it is
 * suggested by that name. Each address is checked once while the picker is
 * open; one whose check failed is checked again when it is typed again.
 */
function useDirectCheck(
  text: string,
  suggestions: RepositorySuggestions,
): DirectCheck | undefined {
  const [checks, setChecks] = useState<ReadonlyMap<string, DirectCheck>>(
    () => new Map(),
  );
  const typed = parseRepositoryInput(text);
  const key = typed ? repositoryKey(typed) : undefined;
  const suggested =
    typed !== undefined &&
    suggestions.repositories.some(({ repository }) =>
      sameRepository(repository, typed),
    );
  const known = key === undefined ? undefined : checks.get(key);
  const due =
    typed !== undefined &&
    !suggested &&
    (known === undefined ||
      (known.status === "done" && known.check.status === "failed"));

  useEffect(() => {
    if (!due || key === undefined) return;
    const at = key;
    function record(check: DirectCheck) {
      setChecks((current) => new Map(current).set(at, check));
    }
    const timer = setTimeout(() => {
      record({ status: "checking", repository: typed });
      void window.verdandi.checkRepository(typed).then(
        (check) => {
          record({ status: "done", repository: typed, check });
        },
        (error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          record({
            status: "done",
            repository: typed,
            check: { status: "failed", problem: { kind: "error", message } },
          });
        },
      );
    }, checkAfter);
    return () => {
      clearTimeout(timer);
    };
    // Checked as the address typed changes, not as its check arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, suggested]);

  return known;
}

/** The direct check with a repository added since, which is tracked now. */
function withOverrides(
  direct: DirectCheck | undefined,
  overrides: ReadonlyMap<number, PickerRepository>,
): DirectCheck | undefined {
  if (direct?.status !== "done" || direct.check.status !== "found") {
    return direct;
  }
  const added = overrides.get(direct.check.repository.id);
  return added
    ? { ...direct, check: { status: "found", repository: added } }
    : direct;
}
