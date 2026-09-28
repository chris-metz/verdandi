import type { OpenIssueCount, SidebarEntries } from "@verdandi/core/contract";

import type { SidebarScope as Scope } from "./scope";

/** A sidebar entry: what it selects, and its open-issue count. */
export interface SidebarItem {
  scope: Scope;
  openIssues: OpenIssueCount;
}

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
    ...sidebar.repositories.map(({ repository, openIssues }): SidebarItem => ({
      scope: { kind: "repository", repository },
      openIssues,
    })),
    ...sidebar.views.map((view): SidebarItem => ({
      scope: { kind: "view", view },
      openIssues: { status: "loading" },
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
