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
  issuePageTrees,
  type IssuePageCommand,
} from "./issue-page-navigation";
import { visibleRows } from "./list-navigation";

const buttonClass =
  "rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/** The issue page replaces the list; each visit has its own saved place. */
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
  const { page, retry } = useIssuePage(visit.issue.id);
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
  const cursor = targets.some(({ id }) => id === visit.place.cursor)
    ? visit.place.cursor
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
  useLayoutEffect(() => {
    if (!page || restored.current || !scroller.current) return;
    restored.current = true;
    scroller.current.scrollTop = initialPlace.scrollTop;
  }, [page, initialPlace]);
  useLayoutEffect(() => {
    if (!reveal.current) return;
    reveal.current = false;
    scroller.current
      ?.querySelector('[data-page-cursor="true"], [aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  });

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
          {!page && (
            <p role="status" className="text-muted-foreground">
              Loading issue…
            </p>
          )}
          {page?.failure && (
            <p role="alert" className="text-destructive">
              {page.failure}{" "}
              <button type="button" className="underline" onClick={retry}>
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
                {page.failure
                  ? "Sub-issues could not be loaded."
                  : "No sub-issues"}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** An abandoned request can fill the core cache but never replace this page. */
function useIssuePage(issueId: string) {
  const [page, setPage] = useState<IssuePage>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    window.verdandi.getIssuePage(issueId).then(
      (loaded) => {
        if (current) setPage(loaded);
      },
      (error: unknown) => {
        if (current)
          setPage({
            issueId,
            issue: undefined,
            ancestry: [],
            subIssues: [],
            failure: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      current = false;
    };
  }, [issueId, attempt]);
  return {
    page,
    retry: () => {
      setAttempt((value) => value + 1);
    },
  };
}
