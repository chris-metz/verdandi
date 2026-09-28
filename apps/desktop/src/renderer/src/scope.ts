import type {
  RepositoryAddress,
  SidebarSelection,
} from "@verdandi/core/contract";

/** A saved view can be arranged before its search list is opened. */
export type SidebarScope = SidebarSelection;

/** How the window presents a scope, wherever it shows it. */
export interface ScopePresentation {
  /**
   * Its name, e.g. in the header: "All", or the repository's `owner/name`.
   * No two scopes share one, so it also tells them apart.
   */
  label: string;
  /** What it lists, e.g. as its sidebar entry's tooltip. */
  description: string;
  /**
   * Its sidebar entry: All pinned on top, or a repository in the
   * Repositories section, with its owner on a second line.
   */
  entry:
    | { section: "pinned"; name: string }
    | { section: "repositories"; name: string; owner: string }
    | { section: "views"; name: string; query: string };
  /** Whether each row of its list names the issue's repository with a chip. */
  repositoryChips: boolean;
}

export function presentScope(scope: SidebarScope): ScopePresentation {
  if (scope.kind === "all") {
    return {
      label: "All",
      description: "Every tracked repository",
      entry: { section: "pinned", name: "All" },
      repositoryChips: true,
    };
  }
  if (scope.kind === "view")
    return {
      label: scope.view.name,
      description: scope.view.query,
      entry: {
        section: "views",
        name: scope.view.name,
        query: scope.view.query,
      },
      repositoryChips: true,
    };
  const { repository } = scope;
  return {
    label: repositoryLabel(repository),
    description: repositoryLabel(repository),
    entry: {
      section: "repositories",
      name: repository.name,
      owner: repository.owner,
    },
    repositoryChips: false,
  };
}

/** How the window names a scope, which also tells scopes apart. */
export function scopeLabel(scope: SidebarScope): string {
  return scope.kind === "view"
    ? `view:${scope.view.id}`
    : presentScope(scope).label;
}

/** Whether two scopes are the same, e.g. a pushed list's and the selected. */
export function sameScope(a: SidebarScope, b: SidebarScope): boolean {
  return scopeLabel(a) === scopeLabel(b);
}

/** How the window names a repository. */
export function repositoryLabel({ owner, name }: RepositoryAddress): string {
  return `${owner}/${name}`;
}
