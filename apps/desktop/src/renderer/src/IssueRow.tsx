import type {
  IssueIdentity,
  IssueSummary,
  Label,
  ParentIssue,
  SubIssueProgress,
} from "@verdandi/core/contract";
import { memo } from "react";
import { cn } from "@/lib/utils";
import type { IssueDestination } from "./issue-navigation";
import { IssueStateIcon } from "./IssueStateIcon";
import type { ListRow } from "./list-navigation";
import { problemText } from "./problem-text";
import {
  colorStyle,
  incompleteTitle,
  labelColors,
  labelOverflow,
  progressCell,
  relationshipCell,
  repositoryChipCell,
  unreadCell,
} from "./row-cells";

/** The widths of the right-aligned columns, shared with their header. */
export const columnClasses = {
  progress: "w-24 shrink-0 justify-end",
  blockedBy: "w-20 shrink-0 justify-end",
  blocking: "w-16 shrink-0 justify-end",
} as const;

/** The same columns above both a scope's list and a page's sub-issues. */
export function IssueColumnHeader({ sticky = false }: { sticky?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-7 items-center gap-1.5 border-b bg-background pr-4 pl-3 text-[11px] font-medium tracking-wide text-muted-foreground uppercase",
        sticky && "sticky top-0 z-10",
      )}
    >
      <span className="flex-1">Issue</span>
      <span className={cn("flex", columnClasses.progress)}>Sub-issues</span>
      <span className={cn("flex", columnClasses.blockedBy)}>Blocked by</span>
      <span className={cn("flex", columnClasses.blocking)}>Blocks</span>
    </div>
  );
}

/**
 * One issue in a list: chevron, state, repository chip in All, reference,
 * title, labels and tags, then the sub-issue progress, "Blocked by" and
 * "Blocks" columns. An issue that has not been read shows as its parent issue
 * names it, with why, and Retry and Open on GitHub once it failed; its
 * columns stay empty, as nothing is known of them.
 */
export const IssueRow = memo(function IssueRow({
  row,
  withRepository,
  selected,
  login,
  onSelect,
  onToggle,
  onOpen,
  onRetry,
}: {
  row: ListRow;
  /** Whether the row names its repository with a chip, as in All. */
  withRepository: boolean;
  selected: boolean;
  /** The account GitHub is read as, if known, to name it when unavailable. */
  login: string | undefined;
  onSelect: (issueId: string) => void;
  onToggle: (issueId: string, expanded: boolean) => void;
  onOpen: (issue: IssueDestination) => void;
  /** Reads what failed on screen again. */
  onRetry: () => void;
}) {
  const { node, depth, parent } = row;
  const { issue } = node;
  const hasSubIssues = node.subIssues.length > 0;
  const read = node.unread ? undefined : node.issue;
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={hasSubIssues ? node.expanded : undefined}
      data-issue-id={issue.id}
      onClick={() => {
        onSelect(issue.id);
        onOpen(issue);
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
          (issue.state === "closed" || !read) && "opacity-55",
        )}
      >
        <IssueStateIcon state={issue.state} />
        {withRepository && <RepositoryChip issue={issue} />}
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {issue.reference}
        </span>
        <span className="min-w-0 truncate">{issue.title}</span>
        {read && <Labels labels={read.labels} />}
        {issue.external && (
          <span
            title="Not in a tracked repository"
            className="shrink-0 rounded-full border border-dashed border-muted-foreground px-1.5 text-[10px] leading-4 text-muted-foreground"
          >
            external
          </span>
        )}
        {read?.incomplete && (
          <WarningIcon title={incompleteTitle(read.incomplete)} />
        )}
      </span>
      {node.unread && (
        <UnreadMarker
          cell={unreadCell(node.unread, login)}
          url={issue.url}
          onRetry={onRetry}
        />
      )}
      {parent && (
        <ParentChip
          parent={parent}
          onOpen={() => {
            onSelect(issue.id);
            onOpen(parent);
          }}
        />
      )}
      <span className="flex-1" />
      <span
        className={cn(
          "flex items-center gap-1.5",
          columnClasses.progress,
          issue.state === "closed" && "opacity-55",
        )}
      >
        {read && <Progress progress={read.subIssueProgress} />}
      </span>
      <span className={cn("flex", columnClasses.blockedBy)}>
        {read && <Relationship issue={read} kind="blockedBy" />}
      </span>
      <span className={cn("flex", columnClasses.blocking)}>
        {read && <Relationship issue={read} kind="blocking" />}
      </span>
    </div>
  );
});

/**
 * Why a row shows an issue only as its parent issue names it: loading, or
 * failed with Retry, Open on GitHub, and GitHub's own link, if it gave one.
 */
function UnreadMarker({
  cell,
  url,
  onRetry,
}: {
  cell: ReturnType<typeof unreadCell>;
  url: string;
  onRetry: () => void;
}) {
  if (!cell.failed) {
    return (
      <span className="shrink-0 text-xs text-muted-foreground">
        {cell.text}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 shrink items-center gap-1 text-xs">
      <WarningIcon title={cell.title} />
      <span title={cell.title} className="min-w-0 truncate text-warning">
        {cell.text}
      </span>
      <RowAction label="Retry" onClick={onRetry} />
      <RowAction
        label="Open on GitHub"
        onClick={() => {
          window.desktop.openExternal(url);
        }}
      />
      {cell.link && (
        <RowAction
          label={cell.link.label}
          onClick={() => {
            if (cell.link) window.desktop.openExternal(cell.link.url);
          }}
        />
      )}
    </span>
  );
}

/** A small action within a row, which leaves the row's selection alone. */
function RowAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="shrink-0 rounded px-1 text-muted-foreground underline-offset-2 hover:bg-accent hover:text-foreground hover:underline"
    >
      {label}
    </button>
  );
}

/** A warning sign, with why in its tooltip. */
export function WarningIcon({ title }: { title: string | undefined }) {
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={title ?? "Warning"}
      className="size-3.5 shrink-0 fill-none stroke-warning stroke-[1.5]"
    >
      {title !== undefined && <title>{title}</title>}
      <path d="M8 2.2 14.3 13.3H1.7z" />
      <path d="M8 6.5v3.2M8 11.4v.4" />
    </svg>
  );
}

function Labels({ labels }: { labels: Label[] }) {
  const { shown, more } = labelOverflow(labels);
  return (
    <>
      {shown.map((label) => (
        <span
          key={label.name}
          style={colorStyle(labelColors(label.color))}
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

/**
 * The chip naming an issue's repository: filled in its owner's colour, or
 * outlined for an external repository.
 */
function RepositoryChip({ issue }: { issue: IssueIdentity }) {
  const { text, title, colors } = repositoryChipCell(issue);
  return (
    <span
      title={title}
      style={colors && colorStyle(colors)}
      className={cn(
        "shrink-0 rounded px-1.5 text-[11px] leading-[18px] font-medium",
        !colors &&
          "text-muted-foreground ring-1 ring-muted-foreground ring-inset",
      )}
    >
      {text}
    </span>
  );
}

/**
 * The ↑ chip naming a parent issue the list does not show above, marked when
 * the parent issue could not be read.
 */
function ParentChip({
  parent,
  onOpen,
}: {
  parent: ParentIssue;
  onOpen: () => void;
}) {
  const failed =
    parent.unread?.status === "failed" ? parent.unread.problem : undefined;
  const why = failed && ` (${problemText(failed).text})`;
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      title={`Sub-issue of ${parent.reference}: ${parent.title}${why ?? ""}`}
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 text-[11px] leading-4 text-muted-foreground",
        failed && "border-dashed border-warning",
      )}
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
    </button>
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
