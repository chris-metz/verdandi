import type {
  IssueIdentity,
  IssueState,
  IssueSummary,
  Label,
  ParentIssue,
  SubIssueProgress,
  UnreadIssue,
} from "@verdandi/core/contract";
import { LoaderCircle, Lock } from "lucide-react";
import { memo, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import type { IssueDestination } from "./issue-navigation";
import { IssueStateIcon } from "./IssueStateIcon";
import { LabelPill, MoreLabels } from "./LabelFilter";
import type { ListRow } from "./list-navigation";
import { preventAutoscroll, useOpenFrom } from "./open-in-new-tab";
import { problemText } from "./problem-text";
import {
  colorStyle,
  createdCell,
  incompleteTitle,
  labelOverflow,
  markTitle,
  progressCell,
  relationshipCell,
  repositoryChipCell,
  unreadCell,
  type MatchedBy,
} from "./row-cells";
import { useNow } from "./use-now";

/** A column right of the title, with its header and its cell of an issue. */
interface IssueColumn {
  key: string;
  header: string;
  /** The header's tooltip, when the header says less. */
  headerTitle?: string;
  /** Its width and how its cell aligns, shared with its header. */
  className: string;
  /**
   * Whether its cell dims with a context issue in a list without a label
   * filter, as the title does: a closed issue in an open list, an open one
   * in a closed list. Where issues are marked, as in a view, every cell of a
   * context issue dims.
   */
  dimsContext: boolean;
  cell: (issue: IssueSummary) => ReactNode;
}

/** The columns right of the title, in order. */
const issueColumns: readonly IssueColumn[] = [
  {
    key: "author",
    header: "By",
    headerTitle: "Author",
    className: "w-7 justify-center",
    dimsContext: true,
    cell: (issue) => <AuthorAvatar issue={issue} />,
  },
  {
    key: "created",
    header: "Created",
    className: "w-16 justify-end",
    dimsContext: true,
    cell: (issue) => <Created issue={issue} />,
  },
  {
    key: "progress",
    header: "Sub-issues",
    className: "w-24 justify-end gap-1.5",
    dimsContext: true,
    cell: (issue) => <Progress progress={issue.subIssueProgress} />,
  },
  {
    key: "blockedBy",
    header: "Blocked by",
    className: "w-20 justify-end",
    dimsContext: false,
    cell: (issue) => <Relationship issue={issue} kind="blockedBy" />,
  },
  {
    key: "blocking",
    header: "Blocks",
    className: "w-16 justify-end",
    dimsContext: false,
    cell: (issue) => <Relationship issue={issue} kind="blocking" />,
  },
];

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
      {issueColumns.map((column) => (
        <span
          key={column.key}
          title={column.headerTitle}
          className={cn("flex shrink-0", column.className)}
        >
          {column.header}
        </span>
      ))}
    </div>
  );
}

/**
 * One issue in a list: chevron, state, repository chip in All, reference,
 * title, labels and tags, then the author, when it was created, sub-issue
 * progress, "Blocked by"
 * and "Blocks" columns. An issue that has not been read shows as its parent issue
 * names it, with why, and Retry and Open on GitHub once it failed; its
 * columns stay empty, as nothing is known of them.
 *
 * Outside views, the issues in the other state than the list's are dimmed:
 * closed issues in an open list, and open ones in a closed list.
 *
 * In a view, or a list its label filter narrows, only context issues are
 * dimmed, as whole rows, counts included; a closed match is not, and only
 * its state icon says closed. A context issue that may match too, as the
 * results are incomplete, has a "?" after its number. A collapsed issue
 * with matches below it says how many.
 *
 * Clicking a label, or one in the popover of `+N`, filters by it instead of
 * opening the issue. A middle click, or a click with ⌘ held (Ctrl
 * elsewhere), opens the issue in a new tab, as it does its parent issue.
 */
export const IssueRow = memo(function IssueRow({
  row,
  listState = "open",
  matchedBy,
  withRepository,
  selected,
  login,
  onSelect,
  onToggle,
  onOpen,
  onRetry,
  onFilterLabel,
}: {
  row: ListRow;
  /**
   * The state of the list it stands in outside views, whose issues are its
   * matches: open unless said otherwise.
   */
  listState?: IssueState;
  /** What makes its issue a match, where it is marked one or not. */
  matchedBy?: MatchedBy | undefined;
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
  /** Adds a label to the label filter of the list. */
  onFilterLabel: (label: Label) => void;
}) {
  const { node, depth, parent, missingParent } = row;
  const { issue, mark } = node;
  const openFrom = useOpenFrom(onOpen);
  const hasSubIssues = node.subIssues.length > 0;
  const read = node.unread ? undefined : node.issue;
  // Where issues are marked, dimming means only "context"; elsewhere it
  // means in the other state than the list's.
  const context = mark !== undefined && !mark.match;
  const stateDimmed = mark === undefined && issue.state !== listState;
  const inside =
    hasSubIssues && !node.expanded ? (mark?.matchesInside ?? 0) : 0;
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={hasSubIssues ? node.expanded : undefined}
      data-issue-id={issue.id}
      title={mark && matchedBy && markTitle(mark, matchedBy)}
      onClick={(event) => {
        onSelect(issue.id);
        openFrom(event, issue);
      }}
      onMouseDown={preventAutoscroll}
      onAuxClick={(event) => {
        if (event.button === 1) openFrom(event, issue);
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
          (stateDimmed || context || !read) && "opacity-55",
        )}
      >
        <IssueStateIcon state={issue.state} />
        {withRepository && <RepositoryChip issue={issue} />}
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {issue.reference}
          {mark?.mayMatch && (
            <span aria-label="may match" className="ml-0.5 font-medium">
              ?
            </span>
          )}
        </span>
        <span className="min-w-0 truncate">{issue.title}</span>
        {read && <Labels labels={read.labels} onFilter={onFilterLabel} />}
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
      {missingParent?.status === "loading" && <LoadingParentChip />}
      {inside > 0 && (
        <span
          title={`${countMatches(inside)} below this issue`}
          className={cn(
            "shrink-0 rounded-full bg-muted px-1.5 text-[11px] leading-4 text-muted-foreground",
            context && "opacity-55",
          )}
        >
          {countMatches(inside)} inside
        </span>
      )}
      {parent && (
        <ParentChip
          parent={parent}
          onOpen={(click) => {
            if (click.button === 0) onSelect(issue.id);
            openFrom(click, parent);
          }}
        />
      )}
      <span className="flex-1" />
      {issueColumns.map((column) => (
        <span
          key={column.key}
          className={cn(
            "flex shrink-0 items-center",
            column.className,
            (context || (column.dimsContext && stateDimmed)) && "opacity-55",
          )}
        >
          {read && column.cell(read)}
        </span>
      ))}
    </div>
  );
});

/** "1 match", "3 matches". */
function countMatches(count: number): string {
  return `${String(count)} ${count === 1 ? "match" : "matches"}`;
}

/** The chip of a match whose parent issue is still loading, in a view. */
function LoadingParentChip() {
  return (
    <span
      title="Loading the parent issue"
      className="flex shrink-0 items-center gap-1 rounded-full border px-1.5 text-[11px] leading-4 text-muted-foreground"
    >
      <LoaderCircle aria-hidden className="size-3 animate-spin" />
      parent issue
    </span>
  );
}

/**
 * The row above a view's tree whose parent issue does not show: GitHub
 * does not show it to this account, or it could not be loaded, with Retry.
 * It is no issue, so the selection passes it by.
 */
export function MissingParentRow({
  missingParent,
  onRetry,
}: {
  missingParent: Extract<UnreadIssue, { status: "failed" }>;
  onRetry: () => void;
}) {
  const notVisible = missingParent.problem.kind === "unavailable";
  return (
    <div
      role="note"
      className="flex h-8 items-center gap-1.5 pr-4 pl-3 whitespace-nowrap text-muted-foreground select-none"
    >
      <span aria-hidden className="size-[18px] shrink-0" />
      {notVisible ? (
        <Lock aria-hidden className="size-3.5 shrink-0" />
      ) : (
        <WarningIcon title={problemText(missingParent.problem).text} />
      )}
      <span className={cn("min-w-0 truncate", !notVisible && "text-warning")}>
        {notVisible
          ? "Parent issue not visible to you"
          : "Parent issue could not be loaded ·"}
      </span>
      {!notVisible && <RowAction label="Retry" onClick={onRetry} />}
    </div>
  );
}

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

/** A row's first labels, each filtering by itself, and `+N` for the rest. */
function Labels({
  labels,
  onFilter,
}: {
  labels: Label[];
  onFilter: (label: Label) => void;
}) {
  const { shown, more } = labelOverflow(labels);
  return (
    <>
      {shown.map((label) => (
        <LabelPill
          key={label.name}
          label={label}
          onFilter={onFilter}
          className="px-1.5 text-[11px] leading-[18px]"
        />
      ))}
      {more && <MoreLabels labels={labels} more={more} onFilter={onFilter} />}
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
  /** Opens the parent issue, where the click asks. */
  onOpen: (click: MouseEvent) => void;
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
        onOpen(event);
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.stopPropagation();
        onOpen(event);
      }}
      title={`Sub-issue of ${parent.reference}: ${parent.title}${why ?? ""}`}
      data-parent-issue-id={parent.id}
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

/**
 * The avatar of who opened an issue, or a dashed circle when their account
 * has been deleted.
 */
function AuthorAvatar({ issue: { author } }: { issue: IssueSummary }) {
  if (!author) {
    return (
      <span
        role="img"
        aria-label="Deleted user"
        title="Deleted user"
        className="size-[18px] shrink-0 rounded-full border border-dashed border-muted-foreground/60"
      />
    );
  }
  return (
    <Avatar
      actor={author}
      title={`Opened by @${author.login}`}
      className="size-[18px]"
    />
  );
}

/** How long ago an issue was opened, with the exact time in its tooltip. */
function Created({ issue: { createdAt } }: { issue: IssueSummary }) {
  return (
    <time
      dateTime={createdAt}
      title={`Opened ${new Date(createdAt).toLocaleString()}`}
      className="text-xs text-muted-foreground tabular-nums"
    >
      {createdCell(createdAt, useNow())}
    </time>
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
