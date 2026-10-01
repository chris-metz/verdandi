import type { Problem, RepositoryAddress } from "@verdandi/core/contract";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { problemText } from "./problem-text";
import { repositoryLabel } from "./scope";

/**
 * Why something could not be read, where it would show: what the window says
 * of the problem, GitHub's own words, and what to do about it: Retry, Open
 * on GitHub where its page is known, and GitHub's own link, if it gave one.
 * A tracked repository whose name another repository took over also offers
 * to track that one instead.
 */
export function ProblemNotice({
  problem,
  login,
  subject,
  url,
  onRetry,
  className,
  onRemove,
  repository,
  onTrackNew,
}: {
  problem: Problem;
  /** The account GitHub is read as, if known, to name it when unavailable. */
  login: string | undefined;
  /** What could not be read, e.g. a repository within All. */
  subject?: string | undefined;
  /** Its page on GitHub, if known. */
  url: string | undefined;
  onRetry: () => void;
  className?: string;
  onRemove?: (() => void) | undefined;
  /** The tracked repository that could not be read, if it is one. */
  repository?: RepositoryAddress | undefined;
  /** Tracks the repository that took over `repository`'s name instead. */
  onTrackNew?: (() => void) | undefined;
}) {
  const { text, detail, link } = problemText(problem, login, repository);
  return (
    <div role="alert" className={cn("space-y-2", className)}>
      <p className="font-medium">
        {subject !== undefined && (
          <span className="text-muted-foreground">{subject} · </span>
        )}
        {text}
      </p>
      {detail !== undefined && (
        <p className="text-xs break-words text-muted-foreground">{detail}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
        {url !== undefined && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              window.desktop.openExternal(url);
            }}
          >
            Open on GitHub
          </Button>
        )}
        {onRemove && (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Remove repository…
          </Button>
        )}
        {onTrackNew && repository && (
          <Button size="sm" variant="ghost" onClick={onTrackNew}>
            Track the new {repositoryLabel(repository)}
          </Button>
        )}
        {link && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              window.desktop.openExternal(link.url);
            }}
          >
            {link.label}
          </Button>
        )}
      </div>
    </div>
  );
}
