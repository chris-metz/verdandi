import type { Notice, SavedView } from "@verdandi/core/contract";
import { useEffect, useState } from "react";
import { noticeText, noticeViews, type WindowNotice } from "./notice-text";

/** How long a notice shows, in milliseconds. */
const shownFor = 10 * 1000;

const windowNoticeListeners = new Set<(notice: WindowNotice) => void>();

/** Shows a notice of the window's own, as the core's show. */
export function showNotice(notice: WindowNotice) {
  for (const listener of windowNoticeListeners) listener(notice);
}

/**
 * The core's notices and the window's own, briefly, in the window's corner,
 * above the setup blocker too. Each goes after a while, or when dismissed.
 * A notice that names views opens each one's dialog.
 */
export function Notices({
  onOpenView,
}: {
  onOpenView: (view: SavedView) => void;
}) {
  const [notices, setNotices] = useState<
    { id: number; notice: Notice | WindowNotice }[]
  >([]);
  useEffect(() => {
    let next = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    function show(notice: Notice | WindowNotice) {
      const id = next++;
      setNotices((shown) => [...shown, { id, notice }]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setNotices((shown) => shown.filter((other) => other.id !== id));
      }, shownFor);
      timers.add(timer);
    }
    const unsubscribe = window.verdandi.on("notice", show);
    windowNoticeListeners.add(show);
    return () => {
      unsubscribe();
      windowNoticeListeners.delete(show);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);
  return (
    <ul
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex max-w-sm flex-col gap-2 text-sm"
    >
      {notices.map(({ id, notice }) => (
        <li
          key={id}
          className="pointer-events-auto flex items-start gap-3 rounded-lg border bg-popover px-4 py-3 text-popover-foreground shadow-lg"
        >
          <div className="min-w-0 flex-1 space-y-1 break-words">
            <p>{noticeText(notice)}</p>
            <NoticeViews notice={notice} onOpenView={onOpenView} />
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setNotices((shown) => shown.filter((other) => other.id !== id));
            }}
            className="shrink-0 rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The views a notice names, each a link to its dialog. */
function NoticeViews({
  notice,
  onOpenView,
}: {
  notice: Notice | WindowNotice;
  onOpenView: (view: SavedView) => void;
}) {
  const named = noticeViews(notice);
  if (!named) return null;
  return (
    <p className="text-muted-foreground">
      {named.label}{" "}
      {named.views.map((view, index) => (
        <span key={view.id}>
          {index > 0 && ", "}
          <button
            type="button"
            onClick={() => {
              onOpenView(view);
            }}
            className="text-foreground underline underline-offset-2"
          >
            {view.name}
          </button>
        </span>
      ))}
    </p>
  );
}
