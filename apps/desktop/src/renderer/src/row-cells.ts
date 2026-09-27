import type {
  IssueSummary,
  Label,
  RelationshipCount,
  SubIssueProgress,
} from "@verdandi/core/contract";

/** At most this many labels show in a row; the rest are counted. */
const labelsShown = 3;

/** The labels a row shows, and the rest as `+N` with their names. */
export function labelOverflow(labels: readonly Label[]): {
  shown: Label[];
  more: { count: number; names: string } | undefined;
} {
  const rest = labels.slice(labelsShown);
  return {
    shown: labels.slice(0, labelsShown),
    more: rest.length
      ? {
          count: rest.length,
          names: rest.map((label) => label.name).join(", "),
        }
      : undefined,
  };
}

/**
 * A label pill's colours: GitHub's colour behind, and dark or white text,
 * whichever reads better on it.
 */
export function labelColors(color: string): {
  background: string;
  foreground: string;
} {
  const hex = /^[0-9a-f]{6}$/i.test(color) ? color : "ededed";
  const value = Number.parseInt(hex, 16);
  const luminance =
    (0.299 * (value >> 16) +
      0.587 * ((value >> 8) & 255) +
      0.114 * (value & 255)) /
    255;
  return {
    background: `#${hex}`,
    foreground: luminance > 0.6 ? "#1f2328" : "#ffffff",
  };
}

/** The sub-issue progress column: a bar filled to `fraction`, and `text`. */
export function progressCell({
  closed,
  total,
}: SubIssueProgress): { fraction: number; text: string } | undefined {
  if (total === 0) return undefined;
  return {
    fraction: closed / total,
    text: `${String(closed)}/${String(total)}`,
  };
}

/**
 * The "Blocked by" or "Blocks" column: the count of open relationships while
 * they are live, or a muted `open/total` when relationships exist but none is
 * live because every other issue or this one is closed. Nothing waits on a
 * closed issue, so its "Blocks" reads `0/total`.
 */
export function relationshipCell(
  kind: "blockedBy" | "blocking",
  state: IssueSummary["state"],
  { open, total }: RelationshipCount,
): { live: boolean; text: string } | undefined {
  if (total === 0) return undefined;
  if (state === "open" && open > 0) return { live: true, text: String(open) };
  const waiting = kind === "blocking" && state === "closed" ? 0 : open;
  return { live: false, text: `${String(waiting)}/${String(total)}` };
}
