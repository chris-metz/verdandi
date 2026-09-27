import type { IssueList, Scope } from "@verdandi/core/contract";
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
import { columnClasses, IssueRow } from "./IssueRow";
import {
  commandForKey,
  selectionIndex,
  visibleRows,
  type ListCommand,
} from "./list-navigation";
import { rememberedPlace, rememberPlace } from "./list-places";
import { listStatus } from "./list-status";
import { repositoryLabel, sameScope } from "./scope";

/**
 * The main area's list of the selected scope: its sub-issue forest, filled as
 * the core pushes it, driven by keyboard and mouse. The selection and scroll
 * position are remembered per scope for the session.
 */
export function IssueListPane({ scope }: { scope: Scope }) {
  const list = useList(scope);
  const [place] = useState(() => rememberedPlace(scope));
  const [selectedId, setSelectedId] = useState(place.selectedId);
  const scroller = useRef<HTMLDivElement>(null);
  const revealSelection = useRef(false);

  const trees = useMemo(() => list?.trees ?? [], [list]);
  const rows = useMemo(() => visibleRows(trees), [trees]);
  const selected = useMemo(
    () => selectionIndex(trees, rows, selectedId),
    [trees, rows, selectedId],
  );

  const select = useCallback(
    (issueId: string) => {
      setSelectedId(issueId);
      rememberPlace(scope, {
        selectedId: issueId,
        scrollTop: scroller.current?.scrollTop ?? 0,
      });
    },
    [scope],
  );
  const toggle = useCallback(
    (issueId: string, expanded: boolean) => {
      void window.verdandi.setExpanded(scope, issueId, expanded);
    },
    [scope],
  );

  function run(command: ListCommand) {
    switch (command.kind) {
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

  // The list takes the keyboard when it opens.
  useEffect(() => {
    scroller.current?.focus({ preventScroll: true });
  }, []);

  // Back where the user left this list, once it is there to scroll.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!list || restored.current || !scroller.current) return;
    restored.current = true;
    scroller.current.scrollTop = place.scrollTop;
  }, [list, place]);

  // A selection moved by keyboard is scrolled into sight.
  useLayoutEffect(() => {
    if (!revealSelection.current) return;
    revealSelection.current = false;
    scroller.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  });

  const failed = list?.loading.status === "failed";
  return (
    <>
      <header className="flex h-12 shrink-0 items-center border-b px-4">
        <h1 className="truncate font-medium">
          {repositoryLabel(scope.repository)}
        </h1>
      </header>
      <div
        ref={scroller}
        role="tree"
        aria-label={`Issues of ${repositoryLabel(scope.repository)}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          rememberPlace(scope, {
            selectedId,
            scrollTop: event.currentTarget.scrollTop,
          });
        }}
        className="group min-h-0 flex-1 overflow-y-auto outline-none"
      >
        {list && (
          <>
            <div
              aria-hidden
              className="sticky top-0 z-10 flex h-7 items-center gap-1.5 border-b bg-background pr-4 pl-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
            >
              <span className="flex-1">Issue</span>
              <span className={cn("flex", columnClasses.progress)}>
                Sub-issues
              </span>
              <span className={cn("flex", columnClasses.blockedBy)}>
                Blocked by
              </span>
              <span className={cn("flex", columnClasses.blocking)}>Blocks</span>
            </div>
            {rows.map((row, index) => (
              <IssueRow
                key={row.node.issue.id}
                row={row}
                selected={index === selected}
                onSelect={select}
                onToggle={toggle}
              />
            ))}
            <p
              role={failed ? "alert" : "status"}
              className={cn(
                "px-4 py-3 whitespace-pre-line text-muted-foreground",
                failed && "text-destructive",
              )}
            >
              {listStatus(list.loading)}
            </p>
          </>
        )}
      </div>
    </>
  );
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
        setList({ scope, trees: [], loading: { status: "failed", message } });
      }
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [scope]);
  return list;
}
