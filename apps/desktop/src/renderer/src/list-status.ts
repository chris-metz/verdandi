import type { IssueList } from "@verdandi/core/contract";

/**
 * The line under a list. It says "No open issues" only once every page has
 * loaded, so missing data never reads as an empty repository.
 */
export function listStatus({ issues, loading }: IssueList): string {
  switch (loading.status) {
    case "loading":
      return "Loading…";
    case "failed":
      return loading.message;
    case "loaded":
      if (issues.length === 0) return "No open issues";
      return issues.length === 1
        ? "1 open issue"
        : `${issues.length.toLocaleString("en-US")} open issues`;
  }
}
