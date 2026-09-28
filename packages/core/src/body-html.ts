/**
 * The link to an uploaded image or video in GitHub's HTML, as it signs it
 * anew in every answer: the same address, with another signature in its
 * query string.
 */
const signedMediaLink =
  /(https:\/\/private-user-images\.githubusercontent\.com\/[^\s"'<>?#]*)\?[^\s"'<>#]*/g;

/** GitHub's HTML without the signatures of its media links. */
function withoutSignatures(html: string): string {
  return html.replace(signedMediaLink, "$1");
}

/**
 * The HTML read before, unless the HTML read now differs from it in more
 * than the signatures of its media links: what shows it need not show it
 * again, and its media need not load again.
 */
export function keepUnlessChanged(
  before: string | undefined,
  now: string,
): string {
  return before !== undefined &&
    withoutSignatures(before) === withoutSignatures(now)
    ? before
    : now;
}
