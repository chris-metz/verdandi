import type { IssueTree } from "@verdandi/core/contract";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import type { IssueDestination } from "./issue-navigation";
import {
  commandForKey,
  followSelection,
  selectionIndex,
  visibleRows,
} from "./list-navigation";
import { rememberedPlace, rememberPlace } from "./list-places";
import type { SidebarScope } from "./scope";
import { keepAnchored, noteAnchor, type ScrollAnchor } from "./scroll-anchor";

/** The row the selection is on. */
const selectedRow = '[aria-selected="true"]';

/**
 * What a sidebar entry's list in the main area does with keyboard and
 * mouse, whatever it lists: the rows its trees show, the selection, which
 * follows its issue as the trees change, or moves to a neighbour if the
 * issue disappeared, and stays where it is on screen, and the selection and
 * scroll position remembered per entry for the session. Expanding and
 * collapsing is the list's own, if it can.
 */
export function useListPane({
  scope,
  list,
  trees,
  hasKeyboard,
  onOpen,
  onSetExpanded,
  onSetAllExpanded,
}: {
  scope: SidebarScope;
  /** The list as last pushed, or none before it arrives. */
  list: object | undefined;
  trees: readonly IssueTree[];
  /**
   * Whether the main area has the keyboard. The list then holds it, also
   * when it opens in place of another list.
   */
  hasKeyboard: boolean;
  onOpen: (issue: IssueDestination) => void;
  onSetExpanded?: (issueId: string, expanded: boolean) => void;
  onSetAllExpanded?: (expanded: boolean) => void;
}) {
  const [place] = useState(() => rememberedPlace(scope));
  const [selectedId, setSelectedId] = useState(place.selectedId);
  const scroller = useRef<HTMLDivElement>(null);
  const revealSelection = useRef(false);

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

  function onKeyDown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const command = commandForKey(event.key, rows, selected, trees);
    if (!command) return;
    event.preventDefault();
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
        onSetExpanded?.(command.issueId, command.expanded);
        break;
      case "setAllExpanded":
        revealSelection.current = true;
        onSetAllExpanded?.(command.expanded);
        break;
      case "openOnGitHub":
        window.desktop.openExternal(command.url);
        break;
    }
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

  return {
    rows,
    /** The index of the selected row. */
    selected,
    select,
    /** The list's scrolling element, which holds the keyboard. */
    scroller,
    onKeyDown,
    onScroll: (event: UIEvent<HTMLElement>) => {
      noteScroll();
      rememberPlace(scope, {
        selectedId,
        scrollTop: event.currentTarget.scrollTop,
      });
    },
  };
}
