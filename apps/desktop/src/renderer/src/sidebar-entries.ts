import type {
  OpenIssueCount,
  Scope,
  SidebarEntries,
} from "@verdandi/core/contract";

/** A sidebar entry: what it selects, and its open-issue count. */
export interface SidebarItem {
  scope: Scope;
  openIssues: OpenIssueCount;
}

/**
 * The sidebar's entries in visual order, which ⌘/Ctrl+1…9 and ↑/↓ follow:
 * the Repositories section, then the Views section, which has none yet.
 */
export function entryOrder(sidebar: SidebarEntries | undefined): SidebarItem[] {
  if (sidebar?.status !== "read") return [];
  return sidebar.repositories.map(({ repository, openIssues }) => ({
    scope: { kind: "repository", repository },
    openIssues,
  }));
}

/**
 * How the sidebar shows an open-issue count: "–" while it is unknown, so a
 * count that is loading or failed never reads as 0.
 */
export function countLabel(count: OpenIssueCount): string {
  return count.status === "known" ? count.count.toLocaleString("en-US") : "–";
}
