import type {
  IssueSummary,
  Label,
  Problem,
  RelationshipCount,
  SubIssueProgress,
  UnreadIssue,
} from "@verdandi/core/contract";
import { problemText, type ProblemText } from "./problem-text";

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

/** The colours of a filled pill or chip: behind, and of its text. */
export interface ColorPair {
  background: string;
  foreground: string;
}

/** An element's inline style for a colour pair. */
export function colorStyle({ background, foreground }: ColorPair): {
  backgroundColor: string;
  color: string;
} {
  return { backgroundColor: background, color: foreground };
}

/**
 * A label pill's colours: GitHub's colour behind, and dark or white text,
 * whichever reads better on it.
 */
export function labelColors(color: string): ColorPair {
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

/** A repository chip, which names in All where each issue lives. */
export interface RepositoryChipCell {
  /** The repository's name, or `owner/name` for an external repository. */
  text: string;
  /** Its tooltip. */
  title: string;
  /**
   * Its owner's colours, which fill the chip; none for an external
   * repository, whose chip is outlined.
   */
  colors: ColorPair | undefined;
}

/**
 * The chip of an issue's repository: a tracked repository's name, filled in
 * its owner's colour, or an external repository's `owner/name`, outlined.
 */
export function repositoryChipCell({
  repository,
  external,
}: Pick<IssueSummary, "repository" | "external">): RepositoryChipCell {
  const { owner, name } = repository;
  const full = `${owner}/${name}`;
  return external
    ? {
        text: full,
        title: `${full} is not a tracked repository`,
        colors: undefined,
      }
    : { text: name, title: full, colors: ownerColors(owner) };
}

/**
 * Owners' chip colours, far apart in hue and each dark enough for white text
 * (4.5:1 or more), so a filled chip reads the same in light and dark.
 */
const ownerPalette = [
  "#b91c1c",
  "#c2410c",
  "#b45309",
  "#4d7c0f",
  "#15803d",
  "#0f766e",
  "#0e7490",
  "#1d4ed8",
  "#4f46e5",
  "#6d28d9",
  "#a21caf",
  "#be185d",
] as const;

/**
 * An owner's chip colours: always the same for one owner, whatever the case
 * of its name, as GitHub ignores it.
 */
export function ownerColors(owner: string): ColorPair {
  // FNV-1a, which spreads similar names apart.
  let hash = 0x811c9dc5;
  for (const char of owner.toLowerCase()) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193);
  }
  const index = (hash >>> 0) % ownerPalette.length;
  return {
    background: ownerPalette[index] ?? "#57606a",
    foreground: "#ffffff",
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

/**
 * What a row says of an issue it shows only as a relationship names it:
 * loading, or why it failed, with GitHub's own link to act on, if any. What
 * GitHub will not show reads as such; any other failure as "Could not be
 * loaded", with why in the tooltip.
 */
export function unreadCell(
  unread: UnreadIssue,
  login: string | undefined,
): {
  text: string;
  title: string | undefined;
  failed: boolean;
  link: ProblemText["link"];
} {
  if (unread.status === "loading") {
    return {
      text: "Loading…",
      title: undefined,
      failed: false,
      link: undefined,
    };
  }
  const { text, detail, link } = problemText(unread.problem, login);
  if (unread.problem.kind === "unavailable") {
    return { text, title: detail, failed: true, link };
  }
  return {
    text: "Could not be loaded",
    title: detail === undefined ? text : `${text}: ${detail}`,
    failed: true,
    link,
  };
}

/** The tooltip of the mark on an issue GitHub showed only in part. */
export function incompleteTitle(problem: Problem): string {
  const { text, detail } = problemText(problem);
  return `Shown in part: ${text}.${detail === undefined ? "" : ` ${detail}`}`;
}
