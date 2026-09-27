import type { RepositoryAddress, Scope } from "@verdandi/core/contract";

/** Whether two scopes are the same, e.g. a pushed list's and the selected. */
export function sameScope(a: Scope, b: Scope): boolean {
  // Every scope is a repository so far; another kind will not typecheck here.
  return (
    a.repository.owner === b.repository.owner &&
    a.repository.name === b.repository.name
  );
}

/** How the window names a repository. */
export function repositoryLabel({ owner, name }: RepositoryAddress): string {
  return `${owner}/${name}`;
}
