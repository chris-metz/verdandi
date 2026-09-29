import type {
  OpenIssueCount,
  RepositoryAddress,
  SidebarEntries,
  RepositoryEntry,
  ViewMatchCount,
} from "@verdandi/core/contract";

import {
  repositoryLabel,
  sameScope,
  type SidebarScope as Scope,
} from "./scope";

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

/**
 * The selected entry as the sidebar lists it now, if it still does: the same
 * view, whatever its name and search now, or the same repository, also
 * renamed or transferred, found by its ID, by its name in another case, or
 * through `renamed`, which maps what the core announced, by the old
 * `owner/name` in lower case, to the new address.
 */
export function followSelection(
  selected: Scope,
  scopes: readonly Scope[],
  renamed: ReadonlyMap<string, RepositoryAddress>,
): Scope | undefined {
  const same = scopes.find((scope) => sameScope(scope, selected));
  if (same || selected.kind !== "repository") return same;
  const repositories = scopes.filter((scope) => scope.kind === "repository");
  const id = idOf(selected.repository);
  const byId =
    id === undefined
      ? undefined
      : repositories.find((scope) => idOf(scope.repository) === id);
  if (byId) return byId;
  const seen = new Set<string>();
  let key = repositoryLabel(selected.repository).toLowerCase();
  while (!seen.has(key)) {
    seen.add(key);
    const found = repositories.find(
      (scope) => repositoryLabel(scope.repository).toLowerCase() === key,
    );
    if (found) return found;
    const next = renamed.get(key);
    if (!next) return undefined;
    key = repositoryLabel(next).toLowerCase();
  }
  return undefined;
}

/** A repository's GitHub ID, when the sidebar entry it came from knows it. */
function idOf(repository: RepositoryAddress): number | undefined {
  return "id" in repository && typeof repository.id === "number"
    ? repository.id
    : undefined;
}
