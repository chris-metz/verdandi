import { sameExceptSignatures } from "./signed-links.ts";

/**
 * The HTML read before, unless the HTML read now differs from it in more
 * than the signatures of its media links: what shows it need not show it
 * again, and its media need not load again.
 */
export function keepUnlessChanged(
  before: string | undefined,
  now: string,
): string {
  return before !== undefined && sameExceptSignatures(before, now)
    ? before
    : now;
}
