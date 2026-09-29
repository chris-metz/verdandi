import type {
  SavedView,
  SearchProblem,
  ViewList,
} from "@verdandi/core/contract";
import { Info, Pencil, RotateCw, TriangleAlert } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { viewFreshness } from "./freshness";
import type { IssueDestination } from "./issue-navigation";
import { IssueColumnHeader, IssueRow, MissingParentRow } from "./IssueRow";
import { ProblemNotice } from "./ProblemNotice";
import { RateLimitStatus } from "./RateLimitStatus";
import { RefreshControl } from "./RefreshControl";
import { useListPane } from "./use-list-pane";
import { matchesLabel, viewStrips, type ViewStrip } from "./view-screen";

/**
 * A view's screen: its name and search, how many issues match, and the
 * matches' trees, each match under its ancestry with context issues around
 * it, from any repository, each row with its repository's chip, outlined
 * for an untracked one. It is driven by keyboard and mouse as a list is,
 * expands and collapses as a list does, and keeps its place as a list does:
 * as matches move under their parent issues, the selection stays on its
 * issue.
 *
 * Strips under the header say what the matches leave out: more than the
 * 1,000 GitHub returns, or what GitHub did not return. A search GitHub
 * failed says why in place of the matches, with **Edit view**.
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
        {list &&
          viewStrips(list).map((strip) => (
            <Strip key={strip.text} strip={strip} onRetry={retry} />
          ))}
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
        {list?.searchProblem &&
        // GitHub rejects the search whatever it matched before.
        (list.searchProblem.kind !== "too-large" || rows.length === 0) ? (
          <SearchFailure
            problem={list.searchProblem}
            onEdit={onEdit}
            onRetry={retry}
          />
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
                <BodyState title="No matching issues" role="status">
                  <p>GitHub found nothing for this search.</p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      GitHub silently ignores qualifiers it doesn&apos;t know: a
                      typo such as <code>lable:bug</code> returns nothing,
                      without an error.
                    </li>
                    <li>
                      Inside an <code>OR</code> group, repositories you
                      can&apos;t read are dropped without notice.
                    </li>
                  </ul>
                  <EditViewButton onEdit={onEdit} />
                </BodyState>
              )}
            </>
          )
        )}
      </div>
    </>
  );
}

/**
 * A strip under a view's header: what its matches leave out, with Retry
 * when running the search again may help.
 */
function Strip({ strip, onRetry }: { strip: ViewStrip; onRetry: () => void }) {
  const Icon = strip.retry ? TriangleAlert : Info;
  return (
    <div
      role="status"
      title={`${strip.text} · ${strip.hint}`}
      className={cn(
        "flex h-7 items-center gap-2 border-t px-4 text-xs whitespace-nowrap",
        strip.retry ? "bg-warning/10" : "bg-muted/50",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-3.5 shrink-0",
          strip.retry ? "text-warning" : "text-muted-foreground",
        )}
      />
      <span className="shrink-0 font-medium">{strip.text}</span>
      {strip.retry && (
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={onRetry}
          className="shrink-0 underline underline-offset-2 hover:text-foreground"
        >
          Retry
        </button>
      )}
      <span className="min-w-0 truncate text-muted-foreground">
        · {strip.hint}
      </span>
    </div>
  );
}

/**
 * Why GitHub failed a view's search, in place of the matches: GitHub's own
 * message when it rejected the search or cannot search what it names,
 * which only editing the search mends, and a hint that it may be too large
 * when GitHub failed it with an empty HTTP 500.
 */
function SearchFailure({
  problem,
  onEdit,
  onRetry,
}: {
  problem: SearchProblem;
  onEdit: () => void;
  onRetry: () => void;
}) {
  switch (problem.kind) {
    case "invalid":
      return (
        <BodyState title="GitHub rejected this search" role="alert">
          <GitHubMessage message={problem.message} />
          <p>It is not run again until the search changes.</p>
          <EditViewButton onEdit={onEdit} />
        </BodyState>
      );
    case "unsearchable":
      return (
        <BodyState
          title="GitHub can't search a repository or user in this view"
          role="alert"
        >
          <GitHubMessage message={problem.message} />
          <p>
            Check the <code>repo:</code>, <code>org:</code> and{" "}
            <code>user:</code> qualifiers.
          </p>
          <EditViewButton onEdit={onEdit} />
        </BodyState>
      );
    case "too-large":
      return (
        <BodyState title="GitHub returned an error" role="alert">
          <p>
            HTTP 500 with an empty body. GitHub answers very long searches this
            way, so the search may be too large.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="text-foreground"
            >
              <RotateCw aria-hidden />
              Retry
            </Button>
            <EditViewButton onEdit={onEdit} />
          </div>
        </BodyState>
      );
  }
}

/** What stands in place of a view's matches, with what to do about it. */
function BodyState({
  title,
  role,
  children,
}: {
  title: string;
  role: "alert" | "status";
  children: ReactNode;
}) {
  return (
    <div
      role={role}
      className="max-w-xl space-y-3 px-4 py-6 text-muted-foreground [&_code]:font-mono [&_code]:text-xs"
    >
      <p className="font-medium text-foreground">{title}</p>
      {children}
    </div>
  );
}

/** GitHub's own words, as it said them. */
function GitHubMessage({ message }: { message: string }) {
  return (
    <pre className="rounded-md border bg-muted/50 px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-foreground">
      {message}
    </pre>
  );
}

/** Opens the view dialog, to mend the search. */
function EditViewButton({ onEdit }: { onEdit: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onEdit}
      className="text-foreground"
    >
      <Pencil aria-hidden />
      Edit view
    </Button>
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
          complete: false,
          incomplete: false,
          searching: undefined,
          searchProblem: undefined,
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
