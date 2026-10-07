import { cn } from "@/lib/utils";
import type { Freshness } from "./freshness";
import { useNow } from "./use-now";

/**
 * A screen's freshness in its header, e.g. "Updated 3 min ago", and the
 * button that refreshes it, which spins while it is read. When the screen
 * shows data it could not read again, or lacks parts, **Retry** reads those
 * again. The age stays true as time passes, without asking GitHub anything.
 */
export function RefreshControl({
  freshness,
  onRefresh,
  onRetry,
}: {
  freshness: (now: number) => Freshness;
  onRefresh: () => void;
  onRetry: () => void;
}) {
  const { text, detail, busy, retry } = freshness(useNow());
  return (
    <>
      <span
        role="status"
        title={detail ?? text}
        className={cn(
          "min-w-0 shrink truncate text-xs text-muted-foreground",
          retry && "text-warning",
        )}
      >
        {text}
      </span>
      {retry && !busy && (
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={onRetry}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground underline-offset-2 hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Retry
        </button>
      )}
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
