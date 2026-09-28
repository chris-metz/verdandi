import type {
  IssueList,
  RepositoryAddress,
  RepositoryEntry,
  TrackedRepository,
  RepositoryLoading,
  Scope,
} from "@verdandi/core/contract";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { listFreshness } from "./freshness";
import type { IssueDestination } from "./issue-navigation";
import { IssueColumnHeader, IssueRow } from "./IssueRow";
import {
  commandForKey,
  followSelection,
  selectionIndex,
  visibleRows,
  type ListCommand,
} from "./list-navigation";
import { rememberedPlace, rememberPlace } from "./list-places";
import { listStatus } from "./list-status";
import { ProblemNotice } from "./ProblemNotice";
import { RateLimitStatus } from "./RateLimitStatus";
import { RefreshControl } from "./RefreshControl";
import { presentScope, repositoryLabel, sameScope } from "./scope";
import { keepAnchored, noteAnchor, type ScrollAnchor } from "./scroll-anchor";

/** The row the selection is on. */
const selectedRow = '[aria-selected="true"]';

/**
 * The main area's list of the selected scope: its sub-issue forest, filled as
 * the core pushes it, driven by keyboard and mouse. The selection and scroll
 * position are remembered per scope for the session. When the list is read
 * again, the selection stays on its issue, or moves to a neighbour if the
 * issue disappeared, and stays where it is on screen.
 */
export function IssueListPane({
  scope,
  login,
  hasKeyboard,
  onOpen,
  repositories,
  onSelectRepository,
  onRemoveRepository,
}: {
  scope: Scope;
  repositories: readonly RepositoryEntry[];
  onSelectRepository: (repository: TrackedRepository) => void;
  onRemoveRepository: ((repository: TrackedRepository) => void) | undefined;
  /** The account GitHub is read as, if known, to name it when unavailable. */
  login: string | undefined;
  onOpen: (issue: IssueDestination) => void;
  /**
   * Whether the main area has the keyboard. The list then holds it, also
   * when it opens in place of another list.
   */
  hasKeyboard: boolean;
}) {
  const list = useList(scope);
  const [place] = useState(() => rememberedPlace(scope));
  const [selectedId, setSelectedId] = useState(place.selectedId);
  const scroller = useRef<HTMLDivElement>(null);
  const revealSelection = useRef(false);

  const trees = useMemo(() => list?.trees ?? [], [list]);
  const rows = useMemo(() => visibleRows(trees), [trees]);
  // The selection follows its issue as the list changes under it.
  const [shownTrees, setShownTrees] = useState(trees);
  if (trees !== shownTrees) {
    setShownTrees(trees);
    const followed = followSelection(shownTrees, trees, selectedId);
    if (followed !== selectedId) setSelectedId(followed);
  }
  const selected = useMemo(
    () => selectionIndex(trees, rows, selectedId),
    [trees, rows, selectedId],
  );

  const select = useCallback((issueId: string) => {
    setSelectedId(issueId);
  }, []);
  const toggle = useCallback(
    (issueId: string, expanded: boolean) => {
      void window.verdandi.setExpanded(scope, issueId, expanded);
    },
    [scope],
  );
  const retry = useCallback(() => {
    void window.verdandi.retry({ kind: "list", scope });
  }, [scope]);

  function run(command: ListCommand) {
    switch (command.kind) {
      case "openIssue":
        select(command.issue.id);
        onOpen(command.issue);
        break;
      case "select":
        revealSelection.current = true;
        select(command.issueId);
        break;
      case "setExpanded":
        toggle(command.issueId, command.expanded);
        break;
      case "setAllExpanded":
        revealSelection.current = true;
        void window.verdandi.setAllExpanded(scope, command.expanded);
        break;
      case "openOnGitHub":
        window.desktop.openExternal(command.url);
        break;
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const command = commandForKey(event.key, rows, selected, trees);
    if (!command) return;
    event.preventDefault();
    run(command);
  }

  // Opened while the sidebar has the keyboard, e.g. by its ↑/↓, the list
  // leaves it there.
  useEffect(() => {
    if (hasKeyboard) scroller.current?.focus({ preventScroll: true });
  }, [hasKeyboard]);

  // Back where the user left this list, once it is there to scroll.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!list || restored.current || !scroller.current) return;
    restored.current = true;
    scroller.current.scrollTop = place.scrollTop;
  }, [list, place]);

  // The selection is remembered wherever it goes, also when it follows its
  // issue to a neighbour.
  useEffect(() => {
    rememberPlace(scope, {
      selectedId,
      scrollTop:
        restored.current && scroller.current
          ? scroller.current.scrollTop
          : place.scrollTop,
    });
  }, [scope, selectedId, place]);

  // A selection moved by keyboard is scrolled into sight.
  useLayoutEffect(() => {
    if (!revealSelection.current) return;
    revealSelection.current = false;
    scroller.current
      ?.querySelector(selectedRow)
      ?.scrollIntoView({ block: "nearest" });
  });

  // What the cursor is on stays where it is on screen as the content changes
  // under it; where it is is noted after every render and scroll.
  const anchor = useRef<ScrollAnchor>(undefined);
  useLayoutEffect(() => {
    if (scroller.current)
      keepAnchored(scroller.current, anchor.current, selectedRow);
  }, [list]);
  useLayoutEffect(noteScroll);
  function noteScroll() {
    anchor.current = scroller.current
      ? noteAnchor(scroller.current, selectedRow)
      : undefined;
  }

  const { label, repositoryChips } = presentScope(scope);
  const repository =
    scope.kind === "repository"
      ? repositories.find((entry) =>
          sameScope(
            { kind: "repository", repository: entry.repository },
            scope,
          ),
        )
      : undefined;
  const failure =
    repository?.unavailable ??
    (list?.loading.status === "failed" ? list.loading.problem : undefined);
  const unavailable = repositories.filter((entry) => entry.unavailable);
  return (
    <>
      <header className="shrink-0 border-b">
        <div className="flex h-12 items-center gap-2 pr-2 pl-4">
          <h1 className="min-w-0 flex-1 truncate font-medium">{label}</h1>
          {list?.archived && (
            <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
              Archived
            </span>
          )}
          <RateLimitStatus />
          {list && (
            <RefreshControl
              freshness={(now) => listFreshness(list, now)}
              onRefresh={() => {
                void window.verdandi.refresh({ kind: "list", scope });
              }}
              onRetry={retry}
            />
          )}
        </div>
        {scope.kind === "all" && unavailable.length > 0 && (
          <UnavailableRepositories
            repositories={unavailable}
            onSelect={onSelectRepository}
          />
        )}
      </header>
      <div
        ref={scroller}
        role="tree"
        aria-label={`Issues of ${label}`}
        tabIndex={0}
        data-pane-focus
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          noteScroll();
          rememberPlace(scope, {
            selectedId,
            scrollTop: event.currentTarget.scrollTop,
          });
        }}
        className="group min-h-0 flex-1 overflow-y-auto outline-none"
      >
        {failure && (repository?.unavailable || rows.length === 0) ? (
          // Nothing to show, so why stands in place of the list.
          <ProblemNotice
            problem={failure}
            login={login}
            url={
              scope.kind === "repository"
                ? `${repositoryUrl(scope.repository)}/issues`
                : undefined
            }
            onRetry={retry}
            onRemove={
              repository && failure.kind === "unavailable" && onRemoveRepository
                ? () => {
                    onRemoveRepository(repository.repository);
                  }
                : undefined
            }
            className="px-4 py-6"
          />
        ) : (
          list && (
            <>
              <RepositoryProblems
                repositories={list.repositories}
                login={login}
                onRetry={retry}
              />
              <IssueColumnHeader sticky />
              {rows.map((row, index) => (
                <IssueRow
                  key={row.node.issue.id}
                  row={row}
                  withRepository={repositoryChips}
                  selected={index === selected}
                  login={login}
                  onOpen={onOpen}
                  onSelect={select}
                  onToggle={toggle}
                  onRetry={retry}
                />
              ))}
              <p
                role={failure ? "alert" : "status"}
                className={cn(
                  "px-4 py-3 whitespace-pre-line text-muted-foreground",
                  failure && "text-warning",
                )}
              >
                {listStatus(list.loading)}
                {failure && (
                  <button
                    type="button"
                    onClick={retry}
                    className="ml-2 underline underline-offset-2"
                  >
                    Retry
                  </button>
                )}
              </p>
            </>
          )
        )}
      </div>
    </>
  );
}

/** All names unavailable entries in their sidebar order, including when every one failed. */
function UnavailableRepositories({
  repositories,
  onSelect,
}: {
  repositories: readonly RepositoryEntry[];
  onSelect: (repository: TrackedRepository) => void;
}) {
  const shown = repositories.slice(0, 2);
  const rest = repositories.slice(2);
  return (
    <div role="status" className="px-4 pb-3 text-xs text-muted-foreground">
      Unavailable:{" "}
      {shown.map(({ repository }, index) => (
        <span key={repositoryLabel(repository)}>
          {index > 0 && (rest.length ? ", " : " and ")}
          <button
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => {
              onSelect(repository);
            }}
          >
            {repositoryLabel(repository)}
          </button>
        </span>
      ))}
      {rest[0] && (
        <>
          {" "}
          and{" "}
          <button
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => {
              if (rest[0]) onSelect(rest[0].repository);
            }}
          >
            {rest.length} more
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The repositories within All that could not be read, each with why and what
 * to do, above the issues of the others.
 */
function RepositoryProblems({
  repositories,
  login,
  onRetry,
}: {
  repositories: readonly RepositoryLoading[];
  login: string | undefined;
  onRetry: () => void;
}) {
  const failed = repositories.flatMap(({ repository, loading }) =>
    loading.status === "failed" && loading.problem.kind !== "unavailable"
      ? [{ repository, problem: loading.problem }]
      : [],
  );
  if (failed.length === 0) return null;
  return (
    <ul
      aria-label="Repositories that could not be read"
      className="space-y-3 border-b px-4 py-3"
    >
      {failed.map(({ repository, problem }) => (
        <li key={repositoryLabel(repository)}>
          <ProblemNotice
            problem={problem}
            login={login}
            subject={repositoryLabel(repository)}
            url={repositoryUrl(repository)}
            onRetry={onRetry}
          />
        </li>
      ))}
    </ul>
  );
}

/** A repository's page on GitHub. */
function repositoryUrl(repository: RepositoryAddress): string {
  return `https://github.com/${repositoryLabel(repository)}`;
}

/** The scope's list as the core pushes it, from the moment it is opened. */
function useList(scope: Scope): IssueList | undefined {
  const [list, setList] = useState<IssueList>();
  useEffect(() => {
    let current = true;
    // The core pushes every list that changes, not only this one.
    const unsubscribe = window.verdandi.on("listChanged", (changed) => {
      if (sameScope(changed.scope, scope)) setList(changed);
    });
    window.verdandi.openList(scope).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (current) {
        setList({
          scope,
          trees: [],
          loading: { status: "failed", problem: { kind: "error", message } },
          repositories: [],
        });
      }
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [scope]);
  return list;
}
