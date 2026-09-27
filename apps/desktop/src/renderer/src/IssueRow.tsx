import type {
  IssueSummary,
  Label,
  ParentIssue,
  SubIssueProgress,
} from "@verdandi/core/contract";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { IssueStateIcon } from "./IssueStateIcon";
import type { ListRow } from "./list-navigation";
import {
  labelColors,
  labelOverflow,
  progressCell,
  relationshipCell,
} from "./row-cells";

/** The widths of the right-aligned columns, shared with their header. */
export const columnClasses = {
  progress: "w-24 shrink-0 justify-end",
  blockedBy: "w-20 shrink-0 justify-end",
  blocking: "w-16 shrink-0 justify-end",
} as const;

/**
 * One issue in a list: chevron, state, reference, title, labels and tags,
 * then the sub-issue progress, "Blocked by" and "Blocks" columns.
 */
export const IssueRow = memo(function IssueRow({
  row,
  selected,
  onSelect,
  onToggle,
}: {
  row: ListRow;
  selected: boolean;
  onSelect: (issueId: string) => void;
  onToggle: (issueId: string, expanded: boolean) => void;
}) {
  const { node, depth, parent } = row;
  const { issue } = node;
  const hasSubIssues = node.subIssues.length > 0;
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={hasSubIssues ? node.expanded : undefined}
      data-issue-id={issue.id}
      onClick={() => {
        onSelect(issue.id);
      }}
      className={cn(
        "flex h-8 scroll-mt-7 items-center gap-1.5 pr-4 pl-3 whitespace-nowrap select-none",
        selected
          ? "bg-muted group-focus:bg-selection group-focus:shadow-[inset_2px_0_0_var(--selection-edge)]"
          : "hover:bg-muted/60",
      )}
    >
      {depth > 0 && (
        <span
          aria-hidden
          className="indent-guides -mr-1.5 shrink-0 self-stretch"
          style={{ width: depth * 20 }}
        />
      )}
      <span
        aria-hidden
        onClick={
          hasSubIssues
            ? (event) => {
                event.stopPropagation();
                onSelect(issue.id);
                onToggle(issue.id, !node.expanded);
              }
            : undefined
        }
        className={cn(
          "flex size-[18px] shrink-0 items-center justify-center rounded text-muted-foreground",
          hasSubIssues && "hover:bg-accent hover:text-foreground",
        )}
      >
        {hasSubIssues && <Chevron expanded={node.expanded} />}
      </span>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          issue.state === "closed" && "opacity-55",
        )}
      >
        <IssueStateIcon state={issue.state} />
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {issue.reference}
        </span>
        <span className="min-w-0 truncate">{issue.title}</span>
        <Labels labels={issue.labels} />
        {issue.external && (
          <span
            title="Not in a tracked repository"
            className="shrink-0 rounded-full border border-dashed border-muted-foreground px-1.5 text-[10px] leading-4 text-muted-foreground"
          >
            external
          </span>
        )}
      </span>
      {parent && <ParentChip parent={parent} />}
      <span className="flex-1" />
      <span
        className={cn(
          "flex items-center gap-1.5",
          columnClasses.progress,
          issue.state === "closed" && "opacity-55",
        )}
      >
        <Progress progress={issue.subIssueProgress} />
      </span>
      <span className={cn("flex", columnClasses.blockedBy)}>
        <Relationship issue={issue} kind="blockedBy" />
      </span>
      <span className={cn("flex", columnClasses.blocking)}>
        <Relationship issue={issue} kind="blocking" />
      </span>
    </div>
  );
});

function Labels({ labels }: { labels: Label[] }) {
  const { shown, more } = labelOverflow(labels);
  return (
    <>
      {shown.map((label) => (
        <span
          key={label.name}
          style={labelStyle(label)}
          className="shrink-0 rounded-full px-1.5 text-[11px] leading-[18px] font-medium"
        >
          {label.name}
        </span>
      ))}
      {more && (
        <span
          title={more.names}
          className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground"
        >
          +{more.count}
        </span>
      )}
    </>
  );
}

function labelStyle({ color }: Label) {
  const { background, foreground } = labelColors(color);
  return { backgroundColor: background, color: foreground };
}

/** The ↑ chip naming a parent issue the list does not show above. */
function ParentChip({ parent }: { parent: ParentIssue }) {
  return (
    <span
      title={`Sub-issue of ${parent.reference}: ${parent.title}`}
      className="flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 text-[11px] leading-4 text-muted-foreground"
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden
        className="size-3 fill-none stroke-current stroke-[1.6]"
      >
        <path d="M8 13V3.5M4.5 7 8 3.5 11.5 7" />
      </svg>
      {parent.reference}
      {parent.external && " · external"}
    </span>
  );
}

function Progress({ progress }: { progress: SubIssueProgress }) {
  const cell = progressCell(progress);
  if (!cell) return null;
  return (
    <>
      <span
        title={`${cell.text} sub-issues closed`}
        className="h-1.5 w-11 shrink-0 overflow-hidden rounded-full bg-muted"
      >
        <span
          className="block h-full bg-issue-closed"
          style={{ width: `${String(cell.fraction * 100)}%` }}
        />
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {cell.text}
      </span>
    </>
  );
}

/** The "Blocked by" or "Blocks" count of an issue. */
function Relationship({
  issue,
  kind,
}: {
  issue: IssueSummary;
  kind: "blockedBy" | "blocking";
}) {
  const cell = relationshipCell(kind, issue.state, issue[kind]);
  if (!cell) return null;
  const blockedBy = kind === "blockedBy";
  return (
    <span
      title={`${blockedBy ? "Blocked by" : "Blocks"}: ${cell.text} open`}
      className={cn(
        "flex h-5 items-center gap-1 rounded-full px-1.5 text-xs tabular-nums",
        !cell.live && "text-muted-foreground",
        cell.live &&
          blockedBy &&
          "bg-blocked-surface font-semibold text-blocked",
        cell.live &&
          !blockedBy &&
          "font-semibold text-blocking ring-1 ring-blocking ring-inset",
      )}
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden
        className="size-3.5 fill-none stroke-current stroke-[1.5]"
      >
        {blockedBy ? (
          <>
            <circle cx="8" cy="8" r="6.2" />
            <path d="m3.7 12.3 8.6-8.6" />
          </>
        ) : (
          <path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" />
        )}
      </svg>
      {cell.text}
    </span>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3 fill-none stroke-current stroke-[1.8]"
    >
      <path d={expanded ? "m3.5 6 4.5 4.5L12.5 6" : "m6 3.5 4.5 4.5L6 12.5"} />
    </svg>
  );
}
