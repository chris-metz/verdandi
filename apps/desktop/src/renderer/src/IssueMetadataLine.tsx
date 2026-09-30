import type {
  IssueMetadata,
  IssueSummary,
  Label,
} from "@verdandi/core/contract";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { ageOf } from "./freshness";
import { LabelPill } from "./LabelFilter";
import { relationshipCell } from "./row-cells";

/**
 * The page's complete metadata, including labels hidden by list overflow,
 * each of which filters the list the page was opened from by itself.
 */
export function IssueMetadataLine({
  issue,
  onFilterLabel,
}: {
  issue: IssueSummary & IssueMetadata;
  onFilterLabel: (label: Label) => void;
}) {
  const notPlanned =
    issue.state === "closed" && issue.stateReason === "not-planned";
  const state =
    issue.state === "open"
      ? "Open"
      : notPlanned
        ? "Closed as not planned"
        : "Closed";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
      <span
        className={cn(
          "rounded-full px-2 py-1 font-medium",
          issue.state === "open"
            ? "bg-issue-open/10 text-issue-open"
            : notPlanned
              ? "bg-muted text-muted-foreground"
              : "bg-issue-closed/10 text-issue-closed",
        )}
      >
        {state}
      </span>
      {(["blockedBy", "blocking"] as const).map((kind) => {
        const cell = relationshipCell(kind, issue.state, issue[kind]);
        return (
          cell && (
            <span
              key={kind}
              title={`${String(issue[kind].open)} open of ${String(issue[kind].total)} total`}
              className={cn(
                "rounded-full border px-2 py-1",
                cell.live &&
                  (kind === "blockedBy"
                    ? "border-blocked/30 bg-blocked-surface text-blocked"
                    : "border-blocking text-blocking"),
              )}
            >
              {kind === "blockedBy" ? "Blocked by" : "Blocks"} {cell.text}
            </span>
          )
        );
      })}
      {issue.labels.map((label) => (
        <LabelPill
          key={label.name}
          label={label}
          onFilter={onFilterLabel}
          className="px-2 py-1"
        />
      ))}
      {issue.assignees.length > 0 && (
        <span className="flex -space-x-1" aria-label="Assignees">
          {issue.assignees.map((assignee) => (
            <Avatar
              key={assignee.login}
              actor={assignee}
              title={`Assigned to @${assignee.login}`}
              className="size-6 border-2 border-background"
            />
          ))}
        </span>
      )}
      {issue.milestone && <span title="Milestone">◇ {issue.milestone}</span>}
      <span>
        {issue.author ? `@${issue.author.login}` : "Deleted user"} opened{" "}
        <time
          dateTime={issue.createdAt}
          title={new Date(issue.createdAt).toLocaleString()}
        >
          {ageOf(issue.createdAt)}
        </time>
      </span>
      <span>
        {issue.commentCount} {issue.commentCount === 1 ? "comment" : "comments"}
      </span>
    </div>
  );
}
