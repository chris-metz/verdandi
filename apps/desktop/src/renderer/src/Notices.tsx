import type { Notice } from "@verdandi/core/contract";
import { useEffect, useState } from "react";
import { noticeText } from "./notice-text";

/** How long a notice shows, in milliseconds. */
const shownFor = 10 * 1000;

/**
 * The core's notices, briefly, in the window's corner, above the setup
 * blocker too. Each goes after a while, or when dismissed.
 */
export function Notices() {
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([]);
  useEffect(() => {
    let next = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const unsubscribe = window.verdandi.on("notice", (notice: Notice) => {
      const id = next++;
      setNotices((shown) => [...shown, { id, text: noticeText(notice) }]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setNotices((shown) => shown.filter((other) => other.id !== id));
      }, shownFor);
      timers.add(timer);
    });
    return () => {
      unsubscribe();
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);
  return (
    <ul
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex max-w-sm flex-col gap-2 text-sm"
    >
      {notices.map(({ id, text }) => (
        <li
          key={id}
          className="pointer-events-auto flex items-start gap-3 rounded-lg border bg-popover px-4 py-3 text-popover-foreground shadow-lg"
        >
          <p className="min-w-0 flex-1 break-words">{text}</p>
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
