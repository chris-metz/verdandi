import type { SavedView, ViewList } from "@verdandi/core/contract";
import { Pencil } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { viewFreshness } from "./freshness";
import type { IssueDestination } from "./issue-navigation";
import { IssueColumnHeader, IssueRow, MissingParentRow } from "./IssueRow";
import { ProblemNotice } from "./ProblemNotice";
import { RateLimitStatus } from "./RateLimitStatus";
import { RefreshControl } from "./RefreshControl";
import { useListPane } from "./use-list-pane";
import { matchesLabel } from "./view-screen";

/**
 * A view's screen: its name and search, how many issues match, and the
 * matches' trees, each match under its ancestry with context issues around
 * it, from any repository, each row with its repository's chip, outlined
 * for an untracked one. It is driven by keyboard and mouse as a list is,
 * expands and collapses as a list does, and keeps its place as a list does:
 * as matches move under their parent issues, the selection stays on its
 * issue.
 */
export function ViewPane({
  view,
  login,
  hasKeyboard,
  onOpen,
  onEdit,
}: {
  view: SavedView;
  /** The account GitHub is read as, if known, to name it when unavailable. */
  login: string | undefined;
  onOpen: (issue: IssueDestination) => void;
  /** Opens the view dialog for this view. */
  onEdit: () => void;
  /** Whether the main area has the keyboard, which the list then holds. */
  hasKeyboard: boolean;
}) {
  const scope = useMemo(() => ({ kind: "view" as const, view }), [view]);
  const screen = useMemo(
    () => ({ kind: "view" as const, viewId: view.id }),
    [view.id],
  );
  const list = useViewList(view);
  const trees = useMemo(() => list?.trees ?? [], [list]);
  const { rows, selected, select, scroller, onKeyDown, onScroll } = useListPane(
    {
      scope,
      list,
      trees,
      hasKeyboard,
      onOpen,
      onSetExpanded: (issueId, expanded) => {
        void window.verdandi.setExpanded(screen, issueId, expanded);
      },
      onSetAllExpanded: (expanded) => {
        void window.verdandi.setAllExpanded(screen, expanded);
      },
    },
  );
  const toggle = useCallback(
    (issueId: string, expanded: boolean) => {
      void window.verdandi.setExpanded(screen, issueId, expanded);
    },
    [screen],
  );
  const retry = useCallback(() => {
    void window.verdandi.retry(screen);
  }, [screen]);

  const failure =
    list?.loading.status === "failed" ? list.loading.problem : undefined;
  return (
    <>
      <header className="shrink-0 border-b">
        <div className="flex h-12 items-center gap-2 pr-2 pl-4">
          <h1 className="min-w-0 shrink truncate font-medium">{view.name}</h1>
          <button
            type="button"
            title="Edit view (E)"
            onClick={onEdit}
            className="min-w-0 shrink truncate rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-xs text-muted-foreground hover:border-ring hover:text-foreground"
          >
            {view.query}
          </button>
          {list?.matchCount !== undefined && (
            <span className="min-w-0 shrink truncate text-xs text-muted-foreground">
              {matchesLabel(
                {
                  matchCount: list.matchCount,
                  pullRequests: list.pullRequests,
                },
                list.matchesShown,
              )}
            </span>
          )}
          <span className="flex-1" />
          <RateLimitStatus />
          {list && (
            <RefreshControl
              freshness={(now) => viewFreshness(list, now)}
              onRefresh={() => {
                void window.verdandi.refresh(screen);
              }}
              onRetry={retry}
            />
          )}
          <Button
            variant="outline"
            size="sm"
            // The keyboard stays where it was.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={onEdit}
          >
            <Pencil aria-hidden />
            Edit view
            <kbd className="font-mono text-[11px] text-muted-foreground">E</kbd>
          </Button>
        </div>
      </header>
      <div
        ref={scroller}
        role="tree"
        aria-label={`Matches of ${view.name}`}
        tabIndex={0}
        data-pane-focus
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        className="group min-h-0 flex-1 overflow-y-auto outline-none"
      >
        {list?.rejected !== undefined ? (
          // GitHub will reject the search again until it changes.
          <div role="alert" className="space-y-2 px-4 py-6">
            <p className="font-medium">GitHub rejected this search</p>
            <pre className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {list.rejected}
            </pre>
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit view
            </Button>
          </div>
        ) : failure && rows.length === 0 ? (
          // Nothing to show, so why stands in place of the matches.
          <ProblemNotice
            problem={failure}
            login={login}
            url={undefined}
            onRetry={retry}
            className="px-4 py-6"
          />
        ) : (
          list && (
            <>
              {rows.length > 0 && <IssueColumnHeader sticky />}
              {rows.map((row, index) => (
                <Fragment key={row.node.issue.id}>
                  {row.missingParent?.status === "failed" && (
                    <MissingParentRow
                      missingParent={row.missingParent}
                      onRetry={retry}
                    />
                  )}
                  <IssueRow
                    row={row}
                    withRepository
                    selected={index === selected}
                    login={login}
                    onOpen={onOpen}
                    onSelect={select}
                    onToggle={toggle}
                    onRetry={retry}
                  />
                </Fragment>
              ))}
              {list.loading.status !== "loading" && rows.length === 0 && (
                <p role="status" className="px-4 py-6 text-muted-foreground">
                  No matching issues
                </p>
              )}
            </>
          )
        )}
      </div>
    </>
  );
}

/** A view's screen as the core pushes it, from the moment it is opened. */
function useViewList(view: SavedView): ViewList | undefined {
  const [list, setList] = useState<ViewList>();
  const { id } = view;
  useEffect(() => {
    let current = true;
    // The core pushes every view that changes, not only this one.
    const unsubscribe = window.verdandi.on("viewChanged", (changed) => {
      if (changed.view.id === id) setList(changed);
    });
    window.verdandi.openView(id).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (current) {
        setList({
          view,
          trees: [],
          matchesShown: 0,
          readingContext: false,
          matchCount: undefined,
          pullRequests: 0,
          rejected: undefined,
          loading: { status: "failed", problem: { kind: "error", message } },
        });
      }
    });
    return () => {
      current = false;
      unsubscribe();
    };
    // Opened once per view; its name or search changing is pushed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return list;
}
