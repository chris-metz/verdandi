import type { IssuePage, Label } from "@verdandi/core/contract";
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
import { loadingFreshness, pageFreshness } from "./freshness";
import { openLinkToIssue } from "./follow-link";
import { BlockingMapBand } from "./BlockingMapBand";
import type { MapTarget } from "./map-navigation";
import { IssueConversation } from "./IssueConversation";
import { IssueMetadataLine } from "./IssueMetadataLine";
import { IssueColumnHeader, IssueRow, WarningIcon } from "./IssueRow";
import type {
  IssueDestination,
  IssueNavigation,
  IssuePlace,
  IssueVisit,
} from "./issue-navigation";
import {
  commandForIssuePageKey,
  followCursor,
  issuePageTrees,
  type CursorPlace,
  type IssuePageCommand,
} from "./issue-page-navigation";
import { visibleRows } from "./list-navigation";
import { ProblemNotice } from "./ProblemNotice";
import { problemText } from "./problem-text";
import { RateLimitStatus } from "./RateLimitStatus";
import { RefreshControl } from "./RefreshControl";
import { incompleteTitle, unreadCell } from "./row-cells";
import type { LinkToIssue } from "./link-target";
import { keepAnchored, noteAnchor, type ScrollAnchor } from "./scroll-anchor";

const buttonClass =
  "rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/** What the cursor is on: an ancestor, the issue itself, or a sub-issue. */
const cursorTarget = '[data-page-cursor="true"], [aria-selected="true"]';

/**
 * What marks the reading position while the cursor is out of view: an
 * issue, the body, or a comment.
 */
const readingTargets = "[data-issue-id], [data-scroll-anchor]";

/**
 * The issue page replaces the list; each visit has its own saved place. When
 * the page is read again, the cursor stays on its issue, or moves to a
 * neighbour if the issue disappeared, and stays where it is on screen; while
 * the cursor is out of view, what is being read stays where it is.
 * Clicking a label, of the issue or of a sub-issue, returns to the list with
 * the label added to its label filter.
 */
export function IssuePagePane({
  visit,
  previous,
  listLabel,
  login,
  hasKeyboard,
  onNavigate,
  onFilterLabel,
}: {
  visit: IssueVisit;
  previous: IssueDestination | undefined;
  listLabel: string;
  /** The account GitHub is read as, if known, to name it when unavailable. */
  login: string | undefined;
  hasKeyboard: boolean;
  onNavigate: (action: IssueNavigation) => void;
  /**
   * Returns to the list the page was opened from, with a label added to its
   * label filter.
   */
  onFilterLabel: (label: Label) => void;
}) {
  const page = useIssuePage(visit.issue.id);
  const screen = { kind: "issue", issueId: visit.issue.id } as const;
  const retry = useCallback(() => {
    void window.verdandi.retry({ kind: "issue", issueId: visit.issue.id });
  }, [visit.issue.id]);
  const failure =
    page?.loading.status === "failed" ? page.loading.problem : undefined;
  // What GitHub no longer shows this account is not shown from before.
  const shownTitle =
    failure?.kind === "unavailable"
      ? undefined
      : (page?.issue?.title ?? visit.issue.title);
  const scroller = useRef<HTMLDivElement>(null);
  const [initialPlace] = useState(visit.place);
  const restored = useRef(false);
  const reveal = useRef(false);
  const anchor = useRef<ScrollAnchor>(undefined);
  const trees = useMemo(
    () => issuePageTrees(page?.subIssues ?? [], visit.place.expanded),
    [page, visit.place.expanded],
  );
  const [mapTargets, setMapTargets] = useState<readonly MapTarget[]>([]);
  const rows = useMemo(() => visibleRows(trees), [trees]);
  const targets = useMemo(
    () => [
      ...(page?.ancestry ?? []),
      page?.issue ?? visit.issue,
      ...rows.map(({ node }) => node.issue),
    ],
    [page, rows, visit.issue],
  );
  // The cursor follows its issue as the page changes under it, or a
  // neighbour if the issue disappeared.
  const targetIds = useMemo(
    () => [
      ...new Set([
        ...targets.map(({ id }) => id),
        ...mapTargets.map(({ id }) => id),
      ]),
    ],
    [targets, mapTargets],
  );
  const [cursorPlace, setCursorPlace] = useState<CursorPlace>({
    targets: targetIds,
    placed: visit.place.cursor,
    shownOn: visit.place.cursor,
  });
  const followed = followCursor(
    cursorPlace,
    targetIds,
    visit.place.cursor,
    mapTargets,
  );
  if (followed !== cursorPlace) setCursorPlace(followed);
  const cursor = targetIds.includes(followed.shownOn)
    ? followed.shownOn
    : visit.issue.id;

  function remember(change: Partial<IssuePlace>) {
    onNavigate({
      kind: "remember",
      place: {
        ...visit.place,
        scrollTop: scroller.current?.scrollTop ?? visit.place.scrollTop,
        ...change,
      },
    });
  }
  function open(issue: IssueDestination) {
    if (!mapTargets.some((target) => target.issue?.id === issue.id))
      remember({ cursor: issue.id });
    onNavigate({ kind: "open", issue });
  }
  // The latest `remember` and `onNavigate`, for following links in bodies,
  // which show again only when they change.
  const navigation = useRef({ remember, onNavigate });
  useLayoutEffect(() => {
    navigation.current = { remember, onNavigate };
  });
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const openLink = useCallback(
    (link: LinkToIssue) =>
      openLinkToIssue(
        link,
        (repository, number) => window.verdandi.lookUpIssue(repository, number),
        {
          open: (issue) => {
            // Only while this page still shows.
            if (!mounted.current) return;
            navigation.current.remember({});
            navigation.current.onNavigate({ kind: "open", issue });
          },
          openExternal: window.desktop.openExternal,
        },
      ),
    [],
  );
  function select(issueId: string) {
    remember({ cursor: issueId });
    scroller.current?.focus({ preventScroll: true });
  }
  function toggle(issueId: string, expanded: boolean) {
    remember({
      cursor: issueId,
      expanded: expanded
        ? [...new Set([...visit.place.expanded, issueId])]
        : visit.place.expanded.filter((id) => id !== issueId),
    });
  }
  function run(command: IssuePageCommand) {
    switch (command.kind) {
      case "activateBlockingEnd":
        void window.verdandi.activateBlockingEnd(visit.issue.id, command.side);
        break;
      case "back":
        onNavigate({ kind: "back" });
        break;
      case "scroll":
        scroller.current?.scrollBy({
          top: command.direction * scroller.current.clientHeight * 0.85,
        });
        break;
      case "select":
        reveal.current = true;
        select(command.issueId);
        break;
      case "openIssue":
        open(command.issue);
        break;
      case "openOnGitHub":
        window.desktop.openExternal(command.url);
        break;
      case "setExpanded":
        toggle(command.issueId, command.expanded);
        break;
      case "setAllExpanded": {
        const ids: string[] = [];
        function collect(nodes: typeof trees) {
          for (const node of nodes) {
            ids.push(node.issue.id);
            collect(
              node.subIssues.map((sub) => ({ ...sub, parent: undefined })),
            );
          }
        }
        if (command.expanded) collect(trees);
        remember({ expanded: ids });
        break;
      }
    }
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Enter on a mouse-focused button or link activates it.
    if (
      event.key === "Enter" &&
      (event.target instanceof HTMLButtonElement ||
        event.target instanceof HTMLAnchorElement)
    )
      return;
    const command = commandForIssuePageKey(
      event,
      cursor,
      targets,
      trees,
      mapTargets,
    );
    if (!command) return;
    event.preventDefault();
    run(command);
  }

  useEffect(() => {
    if (hasKeyboard) scroller.current?.focus({ preventScroll: true });
  }, [hasKeyboard]);
  // Back where the user left this visit, once the page is there to scroll.
  useLayoutEffect(() => {
    if (
      !page?.issue ||
      restored.current ||
      !scroller.current ||
      (page.blockingMap && mapTargets.length === 0)
    )
      return;
    restored.current = true;
    scroller.current.scrollTop = initialPlace.scrollTop;
    anchor.current = undefined;
  }, [page, initialPlace, mapTargets]);
  useLayoutEffect(() => {
    if (!reveal.current) return;
    reveal.current = false;
    scroller.current
      ?.querySelector(cursorTarget)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  // What the cursor is on stays where it is on screen as the content changes
  // under it; where it is is noted after every render and scroll.
  useLayoutEffect(() => {
    if (restored.current && scroller.current)
      keepAnchored(scroller.current, anchor.current, cursorTarget);
  }, [page, mapTargets]);
  useLayoutEffect(noteScroll);
  function noteScroll() {
    if (!restored.current) return;
    anchor.current = scroller.current
      ? noteAnchor(scroller.current, cursorTarget, readingTargets)
      : undefined;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            onNavigate({ kind: "list" });
          }}
        >
          ← {listLabel}
        </button>
        {previous && (
          <button
            type="button"
            className={cn(buttonClass, "min-w-0 truncate")}
            title={`${previous.reference}: ${previous.title}`}
            onClick={() => {
              onNavigate({ kind: "back" });
            }}
          >
            ← {previous.reference} · {previous.title}
          </button>
        )}
        <span className="flex-1" />
        <RateLimitStatus />
        <RefreshControl
          freshness={(now) =>
            page
              ? pageFreshness(page, now)
              : loadingFreshness({ status: "loading" }, now)
          }
          onRefresh={() => {
            void window.verdandi.refresh(screen);
          }}
          onRetry={retry}
        />
        {page?.issue && (
          <button
            type="button"
            className={cn(buttonClass, "shrink-0")}
            onClick={() => {
              if (page.issue) window.desktop.openExternal(page.issue.url);
            }}
          >
            Open on GitHub
          </button>
        )}
      </header>
      <div
        ref={scroller}
        tabIndex={0}
        data-pane-focus
        aria-label={`Issue page: ${visit.issue.title}`}
        onScroll={(event) => {
          noteScroll();
          if (restored.current)
            remember({ scrollTop: event.currentTarget.scrollTop });
        }}
        className="group min-h-0 flex-1 overflow-y-auto outline-none"
      >
        <div className="space-y-4 px-6 pt-6 pb-7">
          {page && page.ancestry.length > 0 && (
            <nav
              aria-label="Issue ancestry"
              className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
            >
              {page.ancestry.map((ancestor, index) => {
                // A parent issue that has not been read ends the ancestry:
                // what lies above it is unknown.
                const unread =
                  ancestor.unread && unreadCell(ancestor.unread, login);
                return (
                  <span
                    key={ancestor.id}
                    className="flex min-w-0 items-center gap-1"
                  >
                    {index > 0 && <span aria-hidden>/</span>}
                    {unread && <span aria-hidden>… /</span>}
                    <button
                      type="button"
                      data-issue-id={ancestor.id}
                      data-page-cursor={cursor === ancestor.id}
                      className={cn(
                        buttonClass,
                        "flex max-w-80 items-center gap-1",
                        unread && "opacity-70",
                        cursor === ancestor.id &&
                          "bg-muted group-focus:bg-selection",
                      )}
                      title={
                        unread
                          ? `${ancestor.title}: ${unread.title ?? unread.text}`
                          : ancestor.title
                      }
                      onClick={() => {
                        open(ancestor);
                      }}
                    >
                      {unread?.failed && <WarningIcon title={unread.text} />}
                      <span className="truncate">
                        {ancestor.reference} · {ancestor.title}
                      </span>
                    </button>
                    {unread?.failed && (
                      <>
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={retry}
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => {
                            window.desktop.openExternal(ancestor.url);
                          }}
                        >
                          Open on GitHub
                        </button>
                      </>
                    )}
                  </span>
                );
              })}
            </nav>
          )}
          <div
            data-issue-id={visit.issue.id}
            data-page-cursor={!page?.blockingMap && cursor === visit.issue.id}
            className={cn(
              "rounded border-l-2 border-transparent pl-3",
              !page?.blockingMap &&
                cursor === visit.issue.id &&
                "group-focus:border-selection-edge",
            )}
          >
            <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
              {page?.issue
                ? `${page.issue.repository.owner}/${page.issue.repository.name}${page.issue.reference.startsWith("#") ? page.issue.reference : ""}`
                : visit.issue.reference}
              {page?.issue?.external && " · external"}
              {page?.issue?.incomplete && (
                <WarningIcon title={incompleteTitle(page.issue.incomplete)} />
              )}
            </p>
            {shownTitle !== undefined && (
              <h1 className="text-2xl font-semibold tracking-tight">
                {shownTitle}
              </h1>
            )}
          </div>
          {page?.issue && (
            <IssueMetadataLine
              issue={page.issue}
              onFilterLabel={onFilterLabel}
            />
          )}
          {!page?.issue && !failure && (
            <p role="status" className="text-muted-foreground">
              Loading issue…
            </p>
          )}
          {failure && (
            <ProblemNotice
              problem={failure}
              login={login}
              url={visit.issue.url}
              onRetry={retry}
            />
          )}
        </div>
        {page?.blockingMap && (
          <BlockingMapBand
            map={page.blockingMap}
            root={visit.issue.id}
            cursor={cursor}
            savedScrollLeft={visit.place.mapScrollLeft}
            onScroll={(mapScrollLeft) => {
              remember({ mapScrollLeft });
            }}
            onLayout={setMapTargets}
            onSelect={select}
            onOpen={open}
            onRetry={retry}
            onActivateEnd={(side) => {
              void window.verdandi.activateBlockingEnd(visit.issue.id, side);
            }}
            onRetryBranch={(cardId, side) => {
              void window.verdandi.retryBlockingBranch(
                visit.issue.id,
                cardId,
                side,
              );
            }}
          />
        )}
        {page?.issue && (
          <section aria-label="Sub-issues" className="border-t">
            <div className="flex items-center justify-between px-6 py-3">
              <h2 className="text-sm font-medium">
                Sub-issues{" "}
                <span className="ml-1 text-muted-foreground">
                  {page.issue.subIssueProgress.closed}/
                  {page.issue.subIssueProgress.total}
                </span>
              </h2>
            </div>
            {rows.length > 0 ? (
              <div role="tree" aria-label="Sub-issues">
                <IssueColumnHeader />
                {rows.map((row) => (
                  <IssueRow
                    key={row.node.issue.id}
                    row={row}
                    withRepository={false}
                    selected={row.node.issue.id === cursor}
                    login={login}
                    onSelect={select}
                    onToggle={toggle}
                    onOpen={open}
                    onRetry={retry}
                    onFilterLabel={onFilterLabel}
                  />
                ))}
              </div>
            ) : (
              <p className="px-6 pb-5 text-muted-foreground">
                {page.loading.status === "loading" ? (
                  "Loading sub-issues…"
                ) : page.issue.subIssueProgress.total > 0 ? (
                  // GitHub counts sub-issues it did not list: why, if it
                  // said, never "none".
                  <>
                    {page.issue.incomplete
                      ? problemText(page.issue.incomplete, login).text
                      : "GitHub did not list its sub-issues"}
                    <button
                      type="button"
                      onClick={retry}
                      className="ml-2 underline underline-offset-2"
                    >
                      Retry
                    </button>
                  </>
                ) : (
                  "No sub-issues"
                )}
              </p>
            )}
          </section>
        )}
        {page?.issue && page.comments && (
          <IssueConversation
            issue={page.issue}
            comments={page.comments}
            login={login}
            onRetry={retry}
            onOpenIssue={openLink}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The issue page as the core pushes it, from the moment it is opened: at
 * once with what it has, then again once it has been read.
 */
function useIssuePage(issueId: string): IssuePage | undefined {
  const [page, setPage] = useState<IssuePage>();
  useEffect(() => {
    let current = true;
    // The core pushes every page that changes, not only this one.
    const unsubscribe = window.verdandi.on("issuePageChanged", (changed) => {
      if (changed.issueId === issueId) setPage(changed);
    });
    window.verdandi.openIssuePage(issueId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (current) {
        setPage({
          issueId,
          issue: undefined,
          ancestry: [],
          subIssues: [],
          comments: undefined,
          loading: { status: "failed", problem: { kind: "error", message } },
        });
      }
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [issueId]);
  return page;
}
