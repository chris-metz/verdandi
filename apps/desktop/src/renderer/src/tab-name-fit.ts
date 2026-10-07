/**
 * How much of a tab's name shows in the room its tab has, from the widths
 * of its parts as laid out.
 */

/** A part of a tab's name that shortens, as wide as it is laid out. */
export interface ShorteningPart {
  /** How wide its first characters are, from none to all of them. */
  widths: readonly number[];
  /** How wide the `…` it ends in once shortened is. */
  ellipsis: number;
}

/** How wide the parts of the issue in a tab's name are laid out. */
export interface IssueWidths {
  /** The `›` before the issue, with a space on each side. */
  separator: number;
  /** The repository in front of the number, if the name has one. */
  repository: ShorteningPart | undefined;
  /** The number, which never shortens. */
  number: number;
}

/** How many characters of each part of a tab's name show. */
export interface TabNameLengths {
  /** None, not even `…`, once the entry and its `›` give way. */
  entry: number | undefined;
  repository: number | undefined;
}

export interface TabNameFit extends TabNameLengths {
  /** Whether the name fits, shortened as far as it goes. */
  fits: boolean;
}

/**
 * How much of a tab's name shows in this much room: whole if it fits, or
 * else its issue's repository shortens first, then its entry, each ending
 * in `…`, down to `…` alone; then the entry and its `›` give way to the
 * issue. The issue's number never shortens.
 */
export function fitTabName(
  room: number,
  entry: ShorteningPart,
  issue: IssueWidths | undefined,
): TabNameFit {
  const repository = issue?.repository;
  const lengthOf = (part: ShorteningPart) => part.widths.length - 1;
  /** Each length a part shortens to, longest first, down to `…` alone. */
  const shorter = (part: ShorteningPart) =>
    Array.from(
      { length: lengthOf(part) },
      (_, index) => lengthOf(part) - 1 - index,
    );
  const widthOf = (part: ShorteningPart, kept: number) =>
    (part.widths[kept] ?? 0) + (kept < lengthOf(part) ? part.ellipsis : 0);
  const fits = (kept: TabNameLengths) =>
    (kept.entry === undefined
      ? 0
      : widthOf(entry, kept.entry) + (issue?.separator ?? 0)) +
      (repository ? widthOf(repository, kept.repository ?? 0) : 0) +
      (issue?.number ?? 0) <=
    // Widths laid out apart may add up to a little more than together.
    room + 0.05;
  /** The repository at its shortest, `…` alone, if the name has one. */
  const shortestRepository = repository && 0;
  const choices: TabNameLengths[] = [
    { entry: lengthOf(entry), repository: repository && lengthOf(repository) },
    ...(repository
      ? shorter(repository).map((kept) => ({
          entry: lengthOf(entry),
          repository: kept,
        }))
      : []),
    ...shorter(entry).map((kept) => ({
      entry: kept,
      repository: shortestRepository,
    })),
    ...(issue ? [{ entry: undefined, repository: shortestRepository }] : []),
  ];
  const fit = choices.find(fits);
  return fit
    ? { ...fit, fits: true }
    : {
        entry: issue ? undefined : 0,
        repository: shortestRepository,
        fits: false,
      };
}

/** A part of a tab's name kept to so many characters, ending in `…`. */
export function shortened(text: string, kept: number): string {
  const characters = Array.from(text);
  return kept >= characters.length
    ? text
    : `${characters.slice(0, kept).join("").trimEnd()}…`;
}
