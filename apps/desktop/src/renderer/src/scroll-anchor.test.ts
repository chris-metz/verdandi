import { describe, expect, it } from "vitest";
import { keepAnchored, noteAnchor } from "./scroll-anchor";

/** How tall every row is, in pixels. */
const rowHeight = 32;

const selectedRow = '[aria-selected="true"]';

/**
 * A scroller showing rows of issues, 32 pixels each, top to bottom, with the
 * selection on one of them. jsdom lays nothing out, so each row reports where
 * it would be: its place in the list, less how far the scroller is scrolled.
 */
function scrollerWith(issueIds: string[], selected: string): HTMLElement {
  const scroller = document.createElement("div");
  fill(scroller, issueIds, selected);
  scroller.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  return scroller;
}

/** Replaces the scroller's rows, as a list pushed anew would. */
function fill(scroller: HTMLElement, issueIds: string[], selected: string) {
  scroller.replaceChildren(
    ...issueIds.map((issueId, index) => {
      const row = document.createElement("div");
      row.dataset.issueId = issueId;
      row.setAttribute("aria-selected", String(issueId === selected));
      row.getBoundingClientRect = () =>
        new DOMRect(0, index * rowHeight - scroller.scrollTop, 800, rowHeight);
      return row;
    }),
  );
}

/** How far below the scroller's top edge an issue's row shows. */
function shownAt(scroller: HTMLElement, issueId: string): number | undefined {
  return scroller
    .querySelector<HTMLElement>(`[data-issue-id="${issueId}"]`)
    ?.getBoundingClientRect().top;
}

describe("scroll anchoring", () => {
  it("keeps the selected row where it was when rows arrive above it", () => {
    const scroller = scrollerWith(["a", "b", "c"], "b");
    const anchor = noteAnchor(scroller, selectedRow);

    fill(scroller, ["x", "y", "a", "b", "c"], "b");
    keepAnchored(scroller, anchor, selectedRow);

    expect(shownAt(scroller, "b")).toBe(rowHeight);
  });

  it("keeps the selected row where it was when rows above it leave", () => {
    const scroller = scrollerWith(["a", "b", "c", "d"], "d");
    scroller.scrollTop = rowHeight;
    const anchor = noteAnchor(scroller, selectedRow);

    fill(scroller, ["c", "d"], "d");
    keepAnchored(scroller, anchor, selectedRow);

    expect(shownAt(scroller, "d")).toBe(2 * rowHeight);
  });

  it("puts the selection's new row where the row of an issue that is gone was", () => {
    const scroller = scrollerWith(["a", "b", "c", "d"], "c");
    const anchor = noteAnchor(scroller, selectedRow);

    fill(scroller, ["x", "y", "z", "a", "d"], "d");
    keepAnchored(scroller, anchor, selectedRow);

    expect(shownAt(scroller, "d")).toBe(2 * rowHeight);
  });

  it("leaves the scroller alone when nothing was selected", () => {
    const scroller = scrollerWith(["a", "b"], "none");
    const anchor = noteAnchor(scroller, selectedRow);

    fill(scroller, ["x", "a", "b"], "b");
    keepAnchored(scroller, anchor, selectedRow);

    expect(anchor).toBeUndefined();
    expect(scroller.scrollTop).toBe(0);
  });
});
