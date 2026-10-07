import type {
  IssueList,
  IssueState,
  Label,
  RepositoryAddress,
  RepositoryEntry,
  TrackedRepository,
  RepositoryLoading,
  Scope,
} from "@verdandi/core/contract";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { listFreshness } from "./freshness";
import { GoToIssueButton } from "./GoToIssueDialog";
import { IssueContextMenu } from "./IssueContextMenu";
import type { IssueDestination } from "./issue-navigation";
import { IssueColumnHeader, IssueRow } from "./IssueRow";
import { LabelFilterChips, NoLabelMatches } from "./LabelFilter";
import { listStatus } from "./list-status";
import { ProblemNotice } from "./ProblemNotice";
import { RateLimitStatus } from "./RateLimitStatus";
import { RefreshControl } from "./RefreshControl";
import { presentScope, repositoryLabel, sameScope } from "./scope";
import { useListPane } from "./use-list-pane";

/**
 * The main area's list of the selected scope: its sub-issue forest, filled as
 * the core pushes it, driven by keyboard and mouse. A switch beside its name
 * shows its open or its closed issues, and chips after it the labels of its
 * label filter, which a label clicked in a row adds to and Esc clears. The
 * selection and scroll position are remembered per scope for the session.
 * When the list is read again, the selection stays on its issue, or moves to
 * a neighbour if the issue disappeared, and stays where it is on screen.
 */
export function IssueListPane({
  tab,
  scope,
  login,
  hasKeyboard,
  onOpen,
  repositories,
  onSelectRepository,
  onRemoveRepository,
  onTrackNewRepository,
  onGoToIssue,
}: {
  /** The tab the list shows in. */
  tab: number;
  scope: Scope;
  repositories: readonly RepositoryEntry[];
  onSelectRepository: (repository: TrackedRepository) => void;
  onRemoveRepository: ((repository: TrackedRepository) => void) | undefined;
  /**
   * Tracks the repository that took over a tracked repository's name in its
   * place.
   */
  onTrackNewRepository: (repository: TrackedRepository) => void;
  /** The account GitHub is read as, if known, to name it when unavailable. */
  login: string | undefined;
  onOpen: (issue: IssueDestination) => void;
  /**
   * Whether the main area has the keyboard. The list then holds it, also
   * when it opens in place of another list.
   */
  hasKeyboard: boolean;
  /** Opens the Go to Issue dialog. */
  onGoToIssue: () => void;
}) {
  const list = useList(scope);
  const trees = useMemo(() => list?.trees ?? [], [list]);
  const labelFilter = list?.labelFilter ?? [];
  const clearLabelFilter = useCallback(() => {
    void window.verdandi.clearLabelFilter(scope);
  }, [scope]);
  const { rows, selected, select, menuTarget, scroller, onKeyDown, onScroll } =
    useListPane({
      tab,
      scope,
      list,
      trees,
      hasKeyboard,
      onOpen,
      onSetExpanded: (issueId, expanded) => {
        void window.verdandi.setExpanded(scope, issueId, expanded);
      },
      onSetAllExpanded: (expanded) => {
        void window.verdandi.setAllExpanded(scope, expanded);
      },
      onClearLabelFilter: labelFilter.length > 0 ? clearLabelFilter : undefined,
    });
  const toggle = useCallback(
    (issueId: string, expanded: boolean) => {
      void window.verdandi.setExpanded(scope, issueId, expanded);
    },
    [scope],
  );
  const retry = useCallback(() => {
    void window.verdandi.retry({ kind: "list", scope });
  }, [scope]);
  const filterLabel = useCallback(
    (label: Label) => {
      void window.verdandi.addLabelToFilter(scope, label);
    },
    [scope],
  );

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
        <div className="flex min-h-12 items-center gap-2 py-1.5 pr-2 pl-4">
          <h1 className="min-w-0 truncate font-medium">{label}</h1>
          {list && (
            <StateSwitch
              state={list.state}
              onSwitch={(state) => {
                void window.verdandi.switchState(scope, state);
              }}
            />
          )}
          <LabelFilterChips
            labels={labelFilter}
            onRemove={(name) => {
              void window.verdandi.removeLabelFromFilter(scope, name);
            }}
          />
          <span className="flex-1" />
          {list?.archived && (
            <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
              Archived
            </span>
          )}
          <RateLimitStatus />
          <GoToIssueButton onClick={onGoToIssue} />
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
      <IssueContextMenu targetAt={menuTarget}>
        <div
          ref={scroller}
          role="tree"
          aria-label={`Issues of ${label}`}
          tabIndex={0}
          data-pane-focus
          onKeyDown={onKeyDown}
          onScroll={onScroll}
          className="group min-h-0 flex-1 overflow-y-auto outline-none"
        >
          {failure && (repository?.unavailable || rows.length === 0) ? (
            // Nothing to show, so why stands in place of the list.
            <ProblemNotice
              problem={failure}
              login={login}
              repository={repository?.repository}
              // Its address would open the repository that took it over.
              url={
                scope.kind === "repository" &&
                !(failure.kind === "unavailable" && failure.nameTakenOver)
                  ? `${repositoryUrl(scope.repository)}/issues`
                  : undefined
              }
              onTrackNew={
                repository &&
                failure.kind === "unavailable" &&
                failure.nameTakenOver
                  ? () => {
                      onTrackNewRepository(repository.repository);
                    }
                  : undefined
              }
              onRetry={retry}
              onRemove={
                repository &&
                failure.kind === "unavailable" &&
                onRemoveRepository
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
                    listState={list.state}
                    matchedBy={labelFilter.length > 0 ? "labels" : undefined}
                    withRepository={repositoryChips}
                    selected={index === selected}
                    login={login}
                    onOpen={onOpen}
                    onSelect={select}
                    onToggle={toggle}
                    onRetry={retry}
                    onFilterLabel={filterLabel}
                  />
                ))}
                {labelFilter.length > 0 &&
                "matches" in list.loading &&
                list.loading.matches === 0 ? (
                  <NoLabelMatches
                    status={listStatus(list.loading, list.state, labelFilter)}
                    onClear={clearLabelFilter}
                  />
                ) : (
                  <p
                    role={failure ? "alert" : "status"}
                    className={cn(
                      "px-4 py-3 whitespace-pre-line text-muted-foreground",
                      failure && "text-warning",
                    )}
                  >
                    {listStatus(list.loading, list.state, labelFilter)}
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
                )}
              </>
            )
          )}
        </div>
      </IssueContextMenu>
    </>
  );
}

/** The states a list switches between, in the switch's order. */
const switchStates: readonly { state: IssueState; label: string }[] = [
  { state: "open", label: "Open" },
  { state: "closed", label: "Closed" },
];

/**
 * The segmented control that shows a list's open or its closed issues, which
 * `s` switches too.
 */
function StateSwitch({
  state,
  onSwitch,
}: {
  state: IssueState;
  onSwitch: (state: IssueState) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Issues shown"
      title="Show open or closed issues (s)"
      className="flex shrink-0 rounded-md border p-0.5 text-xs"
    >
      {switchStates.map((option) => {
        const checked = option.state === state;
        return (
          <button
            key={option.state}
            type="button"
            role="radio"
            aria-checked={checked}
            // The list keeps the keyboard, as `s` would.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              if (!checked) onSwitch(option.state);
            }}
            className={cn(
              "rounded px-2 py-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              checked && "bg-muted font-medium text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
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

/**
 * The scope's list as the core pushes it, from the moment it is opened, in
 * the state the core shows it in.
 */
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
        setList((shown) => ({
          scope,
          state: shown?.state ?? "open",
          labelFilter: shown?.labelFilter ?? [],
          trees: [],
          loading: { status: "failed", problem: { kind: "error", message } },
          repositories: [],
        }));
      }
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [scope]);
  return list;
}
