/**
 * Where an element was in a scroller: how to find it again, how far its top
 * edge was below the scroller's, and whether it was the cursor's.
 */
export interface ScrollAnchor {
  selector: string;
  offset: number;
  cursor: boolean;
}

/**
 * Notes where the element the cursor is on is in a scroller. Elements are
 * told apart by their `data-issue-id`, or else their `data-scroll-anchor`,
 * and `cursor` selects the one the cursor is on. With `reading`, which
 * selects the elements that may mark a reading position, the first of them
 * in view is noted instead while the cursor's is out of view, such as a
 * comment far below the issue's title.
 */
export function noteAnchor(
  scroller: HTMLElement,
  cursor: string,
  reading?: string,
): ScrollAnchor | undefined {
  const bounds = scroller.getBoundingClientRect();
  const cursorTarget = scroller.querySelector<HTMLElement>(cursor);
  let target = cursorTarget;
  if (reading !== undefined && (!target || !inView(target, bounds))) {
    target =
      [...scroller.querySelectorAll<HTMLElement>(reading)].find(
        (element) => element.getBoundingClientRect().bottom > bounds.top,
      ) ?? target;
  }
  if (!target) return undefined;
  const selector = selectorOf(target);
  if (selector === undefined) return undefined;
  return {
    selector,
    offset: offsetIn(scroller, target),
    cursor: target === cursorTarget,
  };
}

/**
 * Scrolls the element noted last back where it was, once the content has
 * changed under it, e.g. as rows above it arrived or left after a refresh,
 * so reading goes on undisturbed. If the cursor's element is gone, the
 * cursor's new place takes its position; if another is gone, the scroller
 * stays where it is, rather than jumping to the cursor out of view.
 */
export function keepAnchored(
  scroller: HTMLElement,
  anchor: ScrollAnchor | undefined,
  cursor: string,
): void {
  if (!anchor) return;
  const target =
    scroller.querySelector<HTMLElement>(anchor.selector) ??
    (anchor.cursor ? scroller.querySelector<HTMLElement>(cursor) : null);
  if (target) scroller.scrollTop += offsetIn(scroller, target) - anchor.offset;
}

/** How to find an element again, by what tells it apart. */
function selectorOf(element: HTMLElement): string | undefined {
  const { issueId, scrollAnchor } = element.dataset;
  if (issueId !== undefined) {
    return `[data-issue-id="${CSS.escape(issueId)}"]`;
  }
  if (scrollAnchor !== undefined) {
    return `[data-scroll-anchor="${CSS.escape(scrollAnchor)}"]`;
  }
  return undefined;
}

/** Whether an element shows within the scroller's bounds. */
function inView(element: HTMLElement, bounds: DOMRect): boolean {
  const { top, bottom } = element.getBoundingClientRect();
  return bottom > bounds.top && top < bounds.bottom;
}

/** How far an element's top edge is below the scroller's. */
function offsetIn(scroller: HTMLElement, element: HTMLElement): number {
  return (
    element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  );
}
