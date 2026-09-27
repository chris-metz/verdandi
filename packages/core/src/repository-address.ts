import type { RepositoryAddress } from "./contract.ts";

/** Splits `owner/name`, if it is one. */
export function parseRepositoryAddress(
  nameWithOwner: string,
): RepositoryAddress | undefined {
  const [owner, name, ...rest] = nameWithOwner.split("/");
  if (!owner || !name || rest.length > 0) return undefined;
  return { owner, name };
}

/**
 * The same key for every spelling of one repository's address, since GitHub
 * ignores case in owner and name.
 */
export function repositoryKey({ owner, name }: RepositoryAddress): string {
  return `${owner}/${name}`.toLowerCase();
}

/** Whether two addresses name the same repository. */
export function sameRepository(
  a: RepositoryAddress,
  b: RepositoryAddress,
): boolean {
  return repositoryKey(a) === repositoryKey(b);
}
