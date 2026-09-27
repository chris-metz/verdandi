import type {
  IssueList,
  ListLoading,
  LoadingState,
} from "@verdandi/core/contract";

/**
 * How a screen's header shows how current it is: what it says, and whether a
 * read is under way, which the refresh button shows by spinning.
 */
export interface Freshness {
  text: string;
  busy: boolean;
}

/**
 * A list's freshness: while All loads, how many of its repositories have
 * loaded; once loaded, the age of what it shows, also while it is read again.
 * A failure shows in the list itself.
 */
export function listFreshness(list: IssueList, now: number): Freshness {
  const { loading, repositories } = list;
  if (loading.status === "loading" && repositories.length > 0) {
    const loaded = repositories.filter(
      ({ loading: part }) =>
        part.status === "current" || part.status === "refreshing",
    ).length;
    const total = repositories.length;
    return {
      text: `Loading… ${String(loaded)} of ${String(total)} ${total === 1 ? "repository" : "repositories"}`,
      busy: true,
    };
  }
  return loadingFreshness(loading, now);
}

/** The freshness of a screen, or of a part of one. */
export function loadingFreshness(
  loading: LoadingState | ListLoading,
  now: number,
): Freshness {
  switch (loading.status) {
    case "loading":
      return { text: "Loading…", busy: true };
    case "refreshing":
      return { text: updatedAgo(loading.updatedAt, now), busy: true };
    case "current":
      return { text: updatedAgo(loading.updatedAt, now), busy: false };
    case "failed":
      return { text: "", busy: false };
  }
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
