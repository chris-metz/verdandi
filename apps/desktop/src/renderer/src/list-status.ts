import type { IssueState, ListLoading } from "@verdandi/core/contract";
import { problemText } from "./problem-text";

/**
 * The line under a list in a state. It gives counts only once everything has
 * loaded, so missing data never reads as an empty repository, except how
 * many closed issues a closed list has read so far; a list that failed shows
 * it only below the issues that loaded before the failure.
 */
export function listStatus(loading: ListLoading, state: IssueState): string {
  switch (loading.status) {
    case "loading": {
      if (state === "open") return "Loading…";
      const { read, total } = loading.progress ?? {};
      return read === undefined || total === undefined
        ? "Loading closed issues…"
        : `Loading closed issues… ${count(read)} of ${count(total)}`;
    }
    case "failed":
      return `Not every ${state} issue could be loaded · ${problemText(loading.problem).text}`;
    case "refreshing":
    case "current":
    case "stale": {
      const { matches, closedNotListed } = loading;
      const listed =
        matches === 0
          ? `No ${state} issues`
          : `${count(matches)} ${state} ${matches === 1 ? "issue" : "issues"}`;
      if (closedNotListed === 0) return listed;
      const closed =
        closedNotListed === 1
          ? "1 closed issue with no open sub-issues is not listed"
          : `${count(closedNotListed)} closed issues with no open sub-issues are not listed`;
      return `${listed} · ${closed}`;
    }
  }
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}
