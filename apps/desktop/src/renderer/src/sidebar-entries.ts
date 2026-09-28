import type {
  OpenIssueCount,
  SidebarEntries,
  RepositoryEntry,
  ViewMatchCount,
} from "@verdandi/core/contract";

import type { SidebarScope as Scope } from "./scope";

/**
 * A sidebar entry: what it selects, and its open-issue count, or a view's
 * match count.
 */
export type SidebarItem =
  | {
      scope: Exclude<Scope, { kind: "view" }>;
      openIssues: OpenIssueCount;
      unavailable?: RepositoryEntry["unavailable"];
    }
  | { scope: Extract<Scope, { kind: "view" }>; matches: ViewMatchCount };

/**
 * The sidebar's entries in visual order, which ⌘/Ctrl+1…9 and ↑/↓ follow:
 * All, pinned on top and always there, then the Repositories section, then
 * the Views section.
 */
export function entryOrder(sidebar: SidebarEntries | undefined): SidebarItem[] {
  if (sidebar?.status !== "read") {
    // All's count is unknown until the tracked repositories are.
    const openIssues: OpenIssueCount =
      sidebar === undefined
        ? { status: "loading" }
        : { status: "failed", message: sidebar.message };
    return [{ scope: { kind: "all" }, openIssues }];
  }
  return [
    { scope: { kind: "all" }, openIssues: sidebar.all.openIssues },
    ...sidebar.repositories.map(
      ({ repository, openIssues, unavailable }): SidebarItem => ({
        scope: { kind: "repository", repository },
        openIssues,
        ...(unavailable ? { unavailable } : {}),
      }),
    ),
    ...sidebar.views.map(({ view, matches }): SidebarItem => ({
      scope: { kind: "view", view },
      matches,
    })),
  ];
}

/**
 * How the sidebar shows an open-issue count: "–" while it is unknown, so a
 * count that is loading or failed never reads as 0.
 */
export function countLabel(count: OpenIssueCount): string {
  return count.status === "known" ? count.count.toLocaleString("en-US") : "–";
}

const abbreviated = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * How the sidebar shows a view's match count: GitHub's total, abbreviated
 * (4.2k), or "–" until the view has run. A rejected search shows a warning
 * instead.
 */
export function matchCountLabel(
  matches: Exclude<ViewMatchCount, { status: "rejected" }>,
): string {
  if (matches.status === "unknown") return "–";
  return abbreviated.format(matches.count).replace("K", "k");
}
