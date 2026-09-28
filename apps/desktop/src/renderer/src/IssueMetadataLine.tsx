import type { IssueMetadata, IssueSummary } from "@verdandi/core/contract";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { ageOf } from "./freshness";
import { colorStyle, labelColors, relationshipCell } from "./row-cells";

/** The page's complete metadata, including labels hidden by list overflow. */
export function IssueMetadataLine({
  issue,
}: {
  issue: IssueSummary & IssueMetadata;
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
        <span
          key={label.name}
          style={colorStyle(labelColors(label.color))}
          className="rounded-full px-2 py-1 font-medium"
        >
          {label.name}
        </span>
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
