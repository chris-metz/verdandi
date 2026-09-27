import type { RepositoryAddress } from "./contract.ts";

/** Splits `owner/name`, if it is one. */
export function parseRepositoryAddress(
  text: string,
): RepositoryAddress | undefined {
  const [owner, name, ...rest] = text.split("/");
  if (!owner || !name || rest.length > 0) return undefined;
  return { owner, name };
}

/** How Verdandi names a repository: `owner/name`. */
export function nameWithOwner({ owner, name }: RepositoryAddress): string {
  return `${owner}/${name}`;
}

/**
 * The same key for every spelling of one repository's address, since GitHub
 * ignores case in owner and name.
 */
export function repositoryKey(repository: RepositoryAddress): string {
  return nameWithOwner(repository).toLowerCase();
}

/** Whether two addresses name the same repository. */
export function sameRepository(
  a: RepositoryAddress,
  b: RepositoryAddress,
): boolean {
  return repositoryKey(a) === repositoryKey(b);
}

/**
 * Each repository once, in order, however often and in whatever case the
 * addresses name it; the first spelling is kept.
 */
export function distinctRepositories(
  repositories: readonly RepositoryAddress[],
): RepositoryAddress[] {
  const distinct = new Map<string, RepositoryAddress>();
  for (const repository of repositories) {
    const key = repositoryKey(repository);
    if (!distinct.has(key)) distinct.set(key, repository);
  }
  return [...distinct.values()];
}
