import type { IssuePage } from "@verdandi/core/contract";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { loadingFreshness } from "./freshness";
import { IssueMetadataLine } from "./IssueMetadataLine";
import { IssueColumnHeader, IssueRow } from "./IssueRow";
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
import { RefreshControl } from "./RefreshControl";
import { keepAnchored, noteAnchor, type ScrollAnchor } from "./scroll-anchor";

const buttonClass =
  "rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/** What the cursor is on: an ancestor, the issue itself, or a sub-issue. */
const cursorTarget = '[data-page-cursor="true"], [aria-selected="true"]';

/**
 * The issue page replaces the list; each visit has its own saved place. When
 * the page is read again, the cursor stays on its issue, or moves to a
 * neighbour if the issue disappeared, and stays where it is on screen.
 */
export function IssuePagePane({
  visit,
  previous,
  listLabel,
  hasKeyboard,
  onNavigate,
}: {
  visit: IssueVisit;
  previous: IssueDestination | undefined;
  listLabel: string;
  hasKeyboard: boolean;
  onNavigate: (action: IssueNavigation) => void;
}) {
  const page = useIssuePage(visit.issue.id);
  const screen = { kind: "issue", issueId: visit.issue.id } as const;
  const scroller = useRef<HTMLDivElement>(null);
  const [initialPlace] = useState(visit.place);
  const restored = useRef(false);
  const reveal = useRef(false);
  const trees = useMemo(
    () => issuePageTrees(page?.subIssues ?? [], visit.place.expanded),
    [page, visit.place.expanded],
  );
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
  const targetIds = useMemo(() => targets.map(({ id }) => id), [targets]);
  const [cursorPlace, setCursorPlace] = useState<CursorPlace>({
    targets: targetIds,
    placed: visit.place.cursor,
    shownOn: visit.place.cursor,
  });
  const followed = followCursor(cursorPlace, targetIds, visit.place.cursor);
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
    remember({ cursor: issue.id });
    onNavigate({ kind: "open", issue });
  }
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
    // Enter on a mouse-focused button activates that button.
    if (event.key === "Enter" && event.target instanceof HTMLButtonElement)
      return;
    const command = commandForIssuePageKey(event, cursor, targets, trees);
    if (!command) return;
    event.preventDefault();
    run(command);
  }

  useEffect(() => {
    if (hasKeyboard) scroller.current?.focus({ preventScroll: true });
  }, [hasKeyboard]);
  // Back where the user left this visit, once the page is there to scroll.
  useLayoutEffect(() => {
    if (!page?.issue || restored.current || !scroller.current) return;
    restored.current = true;
    scroller.current.scrollTop = initialPlace.scrollTop;
  }, [page, initialPlace]);
  useLayoutEffect(() => {
    if (!reveal.current) return;
    reveal.current = false;
    scroller.current
      ?.querySelector(cursorTarget)
      ?.scrollIntoView({ block: "nearest" });
  });
  // What the cursor is on stays where it is on screen as the content changes
  // under it; where it is is noted after every render and scroll.
  const anchor = useRef<ScrollAnchor>(undefined);
  useLayoutEffect(() => {
    if (scroller.current)
      keepAnchored(scroller.current, anchor.current, cursorTarget);
  }, [page]);
  useLayoutEffect(noteScroll);
  function noteScroll() {
    anchor.current = scroller.current
      ? noteAnchor(scroller.current, cursorTarget)
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
        <RefreshControl
          freshness={(now) =>
            loadingFreshness(page?.loading ?? { status: "loading" }, now)
          }
          onRefresh={() => {
            void window.verdandi.refresh(screen);
          }}
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
              {page.ancestry.map((ancestor, index) => (
                <span
                  key={ancestor.id}
                  className="flex min-w-0 items-center gap-1"
                >
                  {index > 0 && <span aria-hidden>/</span>}
                  <button
                    type="button"
                    data-issue-id={ancestor.id}
                    data-page-cursor={cursor === ancestor.id}
                    className={cn(
                      buttonClass,
                      "max-w-80 truncate",
                      cursor === ancestor.id &&
                        "bg-muted group-focus:bg-selection",
                    )}
                    title={ancestor.title}
                    onClick={() => {
                      open(ancestor);
                    }}
                  >
                    {ancestor.reference} · {ancestor.title}
                  </button>
                </span>
              ))}
            </nav>
          )}
          <div
            data-issue-id={visit.issue.id}
            data-page-cursor={cursor === visit.issue.id}
            className={cn(
              "rounded border-l-2 border-transparent pl-3",
              cursor === visit.issue.id && "group-focus:border-selection-edge",
            )}
          >
            <p className="mb-1 text-xs text-muted-foreground">
              {page?.issue
                ? `${page.issue.repository.owner}/${page.issue.repository.name}${page.issue.reference.startsWith("#") ? page.issue.reference : ""}`
                : visit.issue.reference}
              {page?.issue?.external && " · external"}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {page?.issue?.title ?? visit.issue.title}
            </h1>
          </div>
          {page?.issue && <IssueMetadataLine issue={page.issue} />}
          {!page?.issue && page?.loading.status !== "failed" && (
            <p role="status" className="text-muted-foreground">
              Loading issue…
            </p>
          )}
          {page?.loading.status === "failed" && (
            <p role="alert" className="text-destructive">
              {page.loading.message}{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  void window.verdandi.refresh(screen);
                }}
              >
                Retry
              </button>
            </p>
          )}
        </div>
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
                    onSelect={select}
                    onToggle={toggle}
                    onOpen={open}
                  />
                ))}
              </div>
            ) : (
              <p className="px-6 pb-5 text-muted-foreground">
                {page.loading.status === "failed"
                  ? "Sub-issues could not be loaded."
                  : page.loading.status === "loading"
                    ? "Loading sub-issues…"
                    : "No sub-issues"}
              </p>
            )}
          </section>
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
          loading: { status: "failed", message },
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
