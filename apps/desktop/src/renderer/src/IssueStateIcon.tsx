import type { IssueSummary } from "@verdandi/core/contract";
import { cn } from "@/lib/utils";

/** An issue's state as GitHub draws it: a ringed dot if open, a check if closed. */
export function IssueStateIcon({
  state,
  blocked = false,
}: {
  state: IssueSummary["state"];
  blocked?: boolean;
}) {
  const open = state === "open";
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={open ? "Open" : "Closed"}
      className={cn(
        "size-4 shrink-0 fill-none stroke-current stroke-[1.5]",
        blocked
          ? "text-blocked"
          : open
            ? "text-issue-open"
            : "text-issue-closed",
      )}
    >
      <circle cx="8" cy="8" r="6.25" />
      {open ? (
        <circle cx="8" cy="8" r="1.5" className="fill-current stroke-none" />
      ) : (
        <path d="m5.25 8.25 1.9 1.9 3.6-3.8" />
      )}
    </svg>
  );
}
