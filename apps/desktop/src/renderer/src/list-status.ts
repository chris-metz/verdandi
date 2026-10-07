import type {
  IssueState,
  Label,
  ListCounts,
  ListLoading,
} from "@verdandi/core/contract";
import { problemText } from "./problem-text";

/**
 * The line under a list in a state. It gives counts only once everything has
 * loaded, so missing data never reads as an empty repository, except how
 * many closed issues a closed list has read so far; a list that failed shows
 * it only below the issues that loaded before the failure. With a label
 * filter, it counts the matches among the issues in the list's state.
 */
export function listStatus(
  loading: ListLoading,
  state: IssueState,
  labelFilter: readonly Label[] = [],
): string {
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
      if (labelFilter.length > 0) {
        return labelFilterStatus(loading, labelFilter, state);
      }
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

/**
 * How many of the issues in a list's scope carry every label of its label
 * filter, naming the labels: "3 of 12 open issues have bug, ui". A view's
 * issues are in any state.
 */
export function labelFilterStatus(
  { matches, inScope }: Pick<ListCounts, "matches" | "inScope">,
  labelFilter: readonly Label[],
  state?: IssueState,
): string {
  const labels = labelFilter.map(({ name }) => name).join(", ");
  const issues = (plural: boolean) =>
    [state, plural ? "issues" : "issue"].filter(Boolean).join(" ");
  if (matches === 0) return `No ${issues(true)} have ${labels}`;
  return `${count(matches)} of ${count(inScope)} ${issues(inScope !== 1)} ${matches === 1 ? "has" : "have"} ${labels}`;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}
