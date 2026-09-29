import type {
  IssueComments,
  IssueList,
  IssueNode,
  IssuePage,
  ListLoading,
  LoadingState,
  Problem,
  UnreadIssue,
  ViewList,
} from "@verdandi/core/contract";
import { problemText } from "./problem-text";

/**
 * How a screen's header shows how current it is: what it says, and whether a
 * read is under way, which the refresh button shows by spinning. When the
 * screen shows data it could not read again, or lacks parts it could not
 * read, the header offers to retry them.
 */
export interface Freshness {
  text: string;
  /** Why it could not be read again, in more words, e.g. for a tooltip. */
  detail?: string | undefined;
  busy: boolean;
  retry: boolean;
}

/**
 * A list's freshness: while All loads, how many of its repositories have
 * loaded; once loaded, the age of what it shows, also while it is read again,
 * and what of it could not be read. A failure shows in the list itself.
 */
export function listFreshness(list: IssueList, now: number): Freshness {
  const { loading, repositories } = list;
  if (loading.status === "loading" && repositories.length > 0) {
    const loaded = repositories.filter(
      ({ loading: part }) =>
        part.status === "current" ||
        part.status === "refreshing" ||
        part.status === "stale",
    ).length;
    const total = repositories.length;
    return {
      text: `Loading… ${String(loaded)} of ${String(total)} ${total === 1 ? "repository" : "repositories"}`,
      busy: true,
      retry: false,
    };
  }
  const missing = [
    ...missingRepositories(repositories.map((part) => part.loading)),
    ...missingIssues(
      list.trees,
      list.trees.flatMap((tree) => tree.parent?.unread ?? []),
    ),
  ];
  return withMissing(loadingFreshness(loading, now), missing);
}

/**
 * A view's freshness: while its first run reads its pages, which one; while
 * the matches' parent issues and sub-issues load after the search answered,
 * that they do; otherwise the age of its search, and what of its trees
 * could not be read, counting the parent issues above them separately.
 */
export function viewFreshness(list: ViewList, now: number): Freshness {
  const { loading, searching } = list;
  if (loading.status === "loading" && searching) {
    const { page, pages } = searching;
    return {
      text:
        pages === undefined || pages === 1
          ? "Searching…"
          : `Searching… page ${String(page)} of ${String(pages)}`,
      busy: true,
      retry: false,
    };
  }
  if (
    list.readingContext &&
    loading.status !== "loading" &&
    loading.status !== "failed"
  ) {
    return {
      text: "Loading parent issues and sub-issues…",
      busy: true,
      retry: false,
    };
  }
  const missing = [
    ...missingIssues(list.trees, []),
    ...countFailures(
      list.trees.flatMap(({ missingParent }) =>
        missingParent?.status === "failed" ? [missingParent.problem] : [],
      ),
      "parent issue",
      "parent issues",
    ),
  ];
  return withMissing(loadingFreshness(loading, now), missing);
}

/**
 * An issue page's freshness: the age of what it shows, and what of it could
 * not be read, comments included.
 */
export function pageFreshness(page: IssuePage, now: number): Freshness {
  const missing = [
    ...missingIssues(
      page.subIssues,
      page.ancestry.flatMap(({ unread }) => unread ?? []),
      page.issue?.incomplete === undefined ? 0 : 1,
    ),
    ...missingComments(page.comments),
    ...((page.blockingMap?.problems.length ?? 0) > 0
      ? ["blocking relationships shown in part"]
      : []),
  ];
  return withMissing(loadingFreshness(page.loading, now), missing);
}

/** Whether the comments could not all be read, and why. */
function missingComments(comments: IssueComments | undefined): string[] {
  const loading = comments?.loading;
  if (loading?.status === "partial") return ["comments shown in part"];
  if (loading?.status !== "failed") return [];
  return [
    loading.problem.kind === "unavailable"
      ? "comments unavailable"
      : "comments could not be loaded",
  ];
}

/**
 * What the comments say of how far they have loaded, besides showing them,
 * and whether they offer to read again what could not be read; nothing
 * while they are current or being read again, since the page's header says
 * so. `commentCount` is how many GitHub counts. Comments that could not be
 * read at all say why where they would show.
 */
export function commentsStatus(
  comments: IssueComments,
  commentCount: number,
  now: number,
): { text: string; retry: boolean } | undefined {
  const { loading } = comments;
  const shown = comments.comments.length;
  switch (loading.status) {
    case "loading":
      return {
        text:
          shown > 0
            ? `Loading… ${String(shown)} of ${String(Math.max(shown, commentCount))} comments`
            : "Loading comments…",
        retry: false,
      };
    case "current":
      return shown === 0 ? { text: "No comments", retry: false } : undefined;
    case "refreshing":
    case "failed":
      return undefined;
    case "stale":
      return {
        text: `Showing data from ${timeOf(loading.updatedAt, now)} · ${problemText(loading.problem).text}`,
        retry: true,
      };
    case "partial":
      return {
        text: `Showing ${String(shown)} of ${String(Math.max(shown, commentCount))} comments · ${problemText(loading.problem).text}`,
        retry: true,
      };
  }
}

/** The freshness of a screen, or of a part of one. */
export function loadingFreshness(
  loading: LoadingState | ListLoading,
  now: number,
): Freshness {
  switch (loading.status) {
    case "loading":
      return { text: "Loading…", busy: true, retry: false };
    case "refreshing":
      return {
        text: updatedAgo(loading.updatedAt, now),
        busy: true,
        retry: false,
      };
    case "current":
      return {
        text: updatedAgo(loading.updatedAt, now),
        busy: false,
        retry: false,
      };
    case "stale": {
      const { text, detail } = problemText(loading.problem);
      return {
        text: `Showing data from ${timeOf(loading.updatedAt, now)} · ${text}`,
        detail,
        busy: false,
        retry: true,
      };
    }
    case "failed":
      return { text: "", busy: false, retry: false };
  }
}

/** A header's freshness, followed by what could not be read, if anything. */
function withMissing(freshness: Freshness, missing: string[]): Freshness {
  if (missing.length === 0 || freshness.text === "") return freshness;
  return {
    ...freshness,
    text: [freshness.text, ...missing].join(" · "),
    retry: true,
  };
}

/** How many of All's repositories could not be read, and why, e.g. "2 repositories unavailable". */
function missingRepositories(parts: readonly LoadingState[]): string[] {
  return countFailures(
    parts.flatMap((part) => (part.status === "failed" ? [part.problem] : [])),
    "repository",
    "repositories",
  );
}

/**
 * How many issues of a forest, collapsed or not, and of the other issues a
 * screen names, could not be read, and why; and how many GitHub showed only
 * in part, of those and of others the screen shows.
 */
function missingIssues(
  trees: readonly IssueNode[],
  named: readonly UnreadIssue[],
  incompleteBesides = 0,
): string[] {
  const failures: Problem[] = [];
  let incomplete = incompleteBesides;
  const count = (unread: UnreadIssue) => {
    if (unread.status === "failed") failures.push(unread.problem);
  };
  const visit = (node: IssueNode) => {
    if (node.unread) count(node.unread);
    else if (node.issue.incomplete) incomplete++;
    node.subIssues.forEach(visit);
  };
  trees.forEach(visit);
  named.forEach(count);
  return [
    ...countFailures(failures, "issue", "issues"),
    ...(incomplete > 0
      ? [
          `${String(incomplete)} ${incomplete === 1 ? "issue" : "issues"} shown in part`,
        ]
      : []),
  ];
}

/**
 * Counts failures of one kind of thing, those GitHub will not show apart
 * from those that could not be read.
 */
function countFailures(
  problems: readonly Problem[],
  one: string,
  many: string,
): string[] {
  const unavailable = problems.filter(
    (problem) => problem.kind === "unavailable",
  ).length;
  const failed = problems.length - unavailable;
  const name = (count: number) =>
    `${String(count)} ${count === 1 ? one : many}`;
  return [
    ...(unavailable > 0 ? [`${name(unavailable)} unavailable`] : []),
    ...(failed > 0 ? [`${name(failed)} could not be loaded`] : []),
  ];
}

/**
 * When data was read, by the clock: "14:02" today, with the date on another
 * day, e.g. "Sep 26, 09:05".
 */
export function timeOf(time: number, now: number): string {
  const date = new Date(time);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.toDateString() === new Date(now).toDateString()) return clock;
  const day = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${day}, ${clock}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * How long ago data was read, e.g. "Updated 3 min ago": just now within the
 * first minute, then whole minutes, then whole hours.
 */
export function updatedAgo(updatedAt: number, now: number): string {
  const minutes = Math.floor((now - updatedAt) / (60 * 1000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${String(minutes)} min ago`;
  return `Updated ${String(Math.floor(minutes / 60))} h ago`;
}

/** How long ago something happened on GitHub, e.g. "3 days ago". */
export function ageOf(timestamp: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(timestamp)) / 1000);
  if (seconds < 60) return "just now";
  const units = [
    [31536000, "year"],
    [2592000, "month"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ] as const;
  for (const [size, unit] of units) {
    if (seconds >= size)
      return new Intl.RelativeTimeFormat("en", { numeric: "always" }).format(
        -Math.floor(seconds / size),
        unit,
      );
  }
  return timestamp;
}
