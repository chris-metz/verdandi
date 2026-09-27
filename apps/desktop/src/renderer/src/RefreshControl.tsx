import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { Freshness } from "./freshness";

/** How often the age a header shows is brought up to date. */
const tick = 30 * 1000;

/**
 * A screen's freshness in its header, e.g. "Updated 3 min ago", and the
 * button that refreshes it, which spins while it is read. The age stays true
 * as time passes, without asking GitHub anything.
 */
export function RefreshControl({
  freshness,
  onRefresh,
}: {
  freshness: (now: number) => Freshness;
  onRefresh: () => void;
}) {
  const { text, busy } = freshness(useNow());
  return (
    <>
      <span
        role="status"
        className="min-w-0 shrink truncate text-xs text-muted-foreground"
      >
        {text}
      </span>
      <button
        type="button"
        aria-label="Refresh"
        title="Refresh (r)"
        // The keyboard stays where it was.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={onRefresh}
        className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden
          className={cn(
            "size-3.5 fill-none stroke-current stroke-[1.5]",
            busy && "animate-spin",
          )}
        >
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
          <path d="M12.2 1.8v2.6H9.6" />
        </svg>
      </button>
    </>
  );
}

/** The time, brought up to date every half minute. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, tick);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
