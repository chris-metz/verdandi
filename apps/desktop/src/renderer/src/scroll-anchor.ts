/**
 * Where the element the cursor is on was in a scroller: its issue, and how
 * far its top edge was below the scroller's.
 */
export interface ScrollAnchor {
  issueId: string;
  offset: number;
}

/**
 * Notes where the element the cursor is on is in a scroller. Elements are
 * told apart by their `data-issue-id`, and `cursor` selects the one the
 * cursor is on.
 */
export function noteAnchor(
  scroller: HTMLElement,
  cursor: string,
): ScrollAnchor | undefined {
  const target = scroller.querySelector<HTMLElement>(cursor);
  const issueId = target?.dataset.issueId;
  if (!target || issueId === undefined) return undefined;
  return { issueId, offset: offsetIn(scroller, target) };
}

/**
 * Scrolls the element noted last back where it was, once the content has
 * changed under it, e.g. as rows above it arrived or left after a refresh,
 * so reading goes on undisturbed. If its issue is gone, the cursor's new
 * place takes its position.
 */
export function keepAnchored(
  scroller: HTMLElement,
  anchor: ScrollAnchor | undefined,
  cursor: string,
): void {
  if (!anchor) return;
  const target =
    scroller.querySelector<HTMLElement>(
      `[data-issue-id="${CSS.escape(anchor.issueId)}"]`,
    ) ?? scroller.querySelector<HTMLElement>(cursor);
  if (target) scroller.scrollTop += offsetIn(scroller, target) - anchor.offset;
}

/** How far an element's top edge is below the scroller's. */
function offsetIn(scroller: HTMLElement, element: HTMLElement): number {
  return (
    element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  );
}
