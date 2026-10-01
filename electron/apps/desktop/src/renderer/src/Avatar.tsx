import type { IssueActor } from "@verdandi/core/contract";
import { cn } from "@/lib/utils";

/**
 * A GitHub account's avatar, from GitHub's avatar service, with the login's
 * initial beneath until it loads, and instead of it if it cannot.
 */
export function Avatar({
  actor,
  title,
  className,
}: {
  actor: IssueActor;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px]",
        className,
      )}
    >
      <span aria-hidden>{actor.login.slice(0, 1).toUpperCase()}</span>
      <img
        src={actor.avatarUrl}
        alt={`@${actor.login}`}
        referrerPolicy="no-referrer"
        className="absolute inset-0 size-full object-cover"
        onError={(event) => {
          event.currentTarget.hidden = true;
        }}
      />
    </span>
  );
}
