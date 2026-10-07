import type { RepositoryAddress } from "./contract.ts";

/** Splits `owner/name`, if it is one. */
export function parseRepositoryAddress(
  text: string,
): RepositoryAddress | undefined {
  const [owner, name, ...rest] = text.split("/");
  if (!owner || !name || rest.length > 0) return undefined;
  return { owner, name };
}

/** A GitHub login: letters, digits and single inner hyphens. */
const owner = String.raw`[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?`;

/** A repository name: letters, digits, `.`, `-` and `_`. */
const name = String.raw`[A-Za-z0-9._-]+`;

const exactAddress = new RegExp(String.raw`^(${owner})/(${name})$`);

const repositoryUrl = new RegExp(
  String.raw`^(?:https?://)?(?:www\.)?github\.com/(${owner})/(${name})(?:[/?#].*)?$`,
  "i",
);

/**
 * The repository a user typed or pasted, if it names one exactly: `owner/name`,
 * or a github.com URL of it or of a page within it.
 */
export function parseRepositoryInput(
  text: string,
): RepositoryAddress | undefined {
  const trimmed = text.trim();
  const match = exactAddress.exec(trimmed) ?? repositoryUrl.exec(trimmed);
  if (!match?.[1] || !match[2]) return undefined;
  const repository = match[2].replace(/\.git$/, "");
  if (repository === "" || /^\.+$/.test(repository)) return undefined;
  return { owner: match[1], name: repository };
}

/** How Verdandi names a repository: `owner/name`. */
export function nameWithOwner({ owner, name }: RepositoryAddress): string {
  return `${owner}/${name}`;
}

/**
 * How Verdandi names an issue wherever it shows the repository too:
 * `owner/name#12`.
 */
export function qualifiedReference(
  repository: RepositoryAddress,
  number: number,
): string {
  return `${nameWithOwner(repository)}#${String(number)}`;
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
