import { diffChars } from "diff";

/** A genuine location of readable text, independent of its visual clipping. */
export interface FindField {
  key: string;
  text: string;
}

/** One occurrence, with offsets into its field's readable text. */
export interface TextMatch {
  field: string;
  start: number;
  end: number;
  /** The field as searched, to follow this occurrence through later text edits. */
  text?: string;
}

/** Find belongs to a tab for this session, never to startup restoration. */
export interface FindState {
  open: boolean;
  query: string;
  page?: string | undefined;
  active?: TextMatch | undefined;
  /** Repeated Find shortcuts refocus and select the input. */
  focus: number;
  /** A reveal already performed stays performed across tab remounts and manual collapse. */
  revealed?: string | undefined;
  /** Native description/comment sections, kept with this tab after Find closes. */
  details?: Record<string, Record<string, boolean>>;
  /** The field and occurrence to prefer when Return opens a row's issue. */
  transfer?: { field: string; occurrence: number } | undefined;
}

export const emptyFind: FindState = { open: false, query: "", focus: 0 };

export function sameTextMatch(
  a: TextMatch | undefined,
  b: TextMatch | undefined,
): boolean {
  return (
    a === b ||
    (a !== undefined &&
      b !== undefined &&
      a.field === b.field &&
      a.start === b.start &&
      a.end === b.end)
  );
}

/** Keep a surviving occurrence; otherwise follow the old reading order forward. */
export function followTextMatch(
  before: readonly TextMatch[],
  after: readonly TextMatch[],
  active: TextMatch | undefined,
): TextMatch | undefined {
  const changes = new Map<string, ReturnType<typeof diffChars> | undefined>();
  const kept = retainMatch(after, active, changes);
  if (kept) return kept;
  const index = before.findIndex((match) => sameTextMatch(match, active));
  for (const match of before.slice(index + 1)) {
    const next = retainMatch(after, match, changes);
    if (next) return next;
  }
  return after[0];
}

/** Follow this occurrence through separate insertions and deletions in its field. */
export function retainedTextMatch(
  after: readonly TextMatch[],
  active: TextMatch | undefined,
): TextMatch | undefined {
  return retainMatch(after, active, new Map());
}

function retainMatch(
  after: readonly TextMatch[],
  active: TextMatch | undefined,
  changesByField: Map<string, ReturnType<typeof diffChars> | undefined>,
): TextMatch | undefined {
  if (!active) return undefined;
  const field = after.filter((match) => match.field === active.field);
  const oldText = active.text;
  const newText = field[0]?.text;
  if (oldText === undefined || newText === undefined || oldText === newText)
    return field.find((match) => sameTextMatch(match, active));
  let oldOffset = 0;
  let newOffset = 0;
  // A wholesale rewrite must not block typing indefinitely. If it cannot be
  // aligned promptly, followTextMatch still picks the next known location.
  if (!changesByField.has(active.field))
    changesByField.set(
      active.field,
      diffChars(oldText, newText, { ignoreCase: true, timeout: 20 }),
    );
  for (const change of changesByField.get(active.field) ?? []) {
    const length = change.value.length;
    if (
      !change.added &&
      !change.removed &&
      active.start >= oldOffset &&
      active.end <= oldOffset + length
    ) {
      const offset = newOffset - oldOffset;
      return field.find(
        (match) =>
          match.start === active.start + offset &&
          match.end === active.end + offset,
      );
    }
    if (!change.added) oldOffset += length;
    if (!change.removed) newOffset += length;
  }
  return undefined;
}

export function textMatchKey(
  page: string,
  query: string,
  match: TextMatch | undefined,
): string {
  return match
    ? JSON.stringify([page, query, match.field, match.start, match.end])
    : "";
}

export function stepTextMatch(
  matches: readonly TextMatch[],
  active: TextMatch | undefined,
  by: 1 | -1,
): TextMatch | undefined {
  const index = matches.findIndex((match) => sameTextMatch(match, active));
  return matches[(index + by + matches.length) % matches.length];
}

/** Literal, case-insensitive occurrences in the content's reading order. */
export function findText(
  fields: readonly FindField[],
  query: string,
): TextMatch[] {
  if (!query) return [];
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu",
  );
  return fields.flatMap(({ key, text }) =>
    [...text.matchAll(pattern)].map(({ index, 0: matched }) => ({
      field: key,
      start: index,
      end: index + matched.length,
      text,
    })),
  );
}
