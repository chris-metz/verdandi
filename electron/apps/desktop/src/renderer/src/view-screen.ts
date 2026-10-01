import type { ViewList } from "@verdandi/core/contract";

/**
 * How a view's header counts its matches, as GitHub counts them: "7
 * matches"; "100 of 4,213 matches shown" when fewer are listed; and the
 * pull requests among them, which are never listed.
 */
export function matchesLabel(
  { matchCount, pullRequests }: { matchCount: number; pullRequests: number },
  listed: number,
): string {
  const total = count(matchCount);
  const matches =
    listed + pullRequests < matchCount
      ? `${count(listed)} of ${total} matches shown`
      : `${total} ${matchCount === 1 ? "match" : "matches"}`;
  if (pullRequests === 0) return matches;
  return `${matches} · ${count(pullRequests)} ${pullRequests === 1 ? "pull request" : "pull requests"} not listed`;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

/** A strip under a view's header, saying what its matches leave out. */
export interface ViewStrip {
  text: string;
  /** What follows from it, in more words. */
  hint: string;
  /** Whether it offers to run the search again. */
  retry: boolean;
}

/**
 * What a view's strips say once its search has read every page of its first
 * run: that it shows only the first 1,000 of more matches, and that GitHub
 * did not return all matches. Either way, context issues may match too.
 */
export function viewStrips(
  list: Pick<
    ViewList,
    "view" | "matchCount" | "inScope" | "incomplete" | "loading"
  >,
): ViewStrip[] {
  const { matchCount, loading } = list;
  if (loading.status === "loading" || loading.status === "failed") return [];
  const strips: ViewStrip[] = [];
  if (matchCount !== undefined && matchCount > 1000) {
    const sort = /(?:^|\s)(sort:\S+)/.exec(list.view.query)?.[1];
    strips.push({
      text: `${count(list.inScope)} of ${count(matchCount)} matches shown · narrow the search`,
      hint: `${
        sort
          ? `${sort} in the search decides which 1,000`
          : "without sort: in the search, GitHub returns the newest-created 1,000"
      }; context issues may match too`,
      retry: false,
    });
  }
  if (list.incomplete) {
    strips.push({
      text: "GitHub did not return all matches",
      hint: "context issues may match too",
      retry: true,
    });
  }
  return strips;
}
