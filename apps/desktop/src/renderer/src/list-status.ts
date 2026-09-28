import type { ListLoading } from "@verdandi/core/contract";
import { problemText } from "./problem-text";

/**
 * The line under a list. It gives counts only once everything has loaded, so
 * missing data never reads as an empty repository; a list that failed shows
 * it only below the issues that loaded before the failure.
 */
export function listStatus(loading: ListLoading): string {
  switch (loading.status) {
    case "loading":
      return "Loading…";
    case "failed":
      return `Not every open issue could be loaded · ${problemText(loading.problem).text}`;
    case "refreshing":
    case "current":
    case "stale": {
      const { openIssues, closedNotListed } = loading;
      const open =
        openIssues === 0
          ? "No open issues"
          : `${count(openIssues)} open ${openIssues === 1 ? "issue" : "issues"}`;
      if (closedNotListed === 0) return open;
      const closed =
        closedNotListed === 1
          ? "1 closed issue with no open sub-issues is not listed"
          : `${count(closedNotListed)} closed issues with no open sub-issues are not listed`;
      return `${open} · ${closed}`;
    }
  }
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}
