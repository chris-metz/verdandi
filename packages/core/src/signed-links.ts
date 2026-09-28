/**
 * GitHub's links to uploaded images and videos, as it signs them anew in
 * every answer: the same address, with another signature in its query
 * string, which expires five minutes later. The core and interfaces both
 * tell such links apart by their address.
 */

/** A signed link in GitHub's HTML, with its address before the signature. */
const signedLink =
  /(https:\/\/private-user-images\.githubusercontent\.com\/[^\s"'<>?#]*)\?[^\s"'<>#]*/g;

/** GitHub's HTML without the signatures of its media links. */
function withoutSignatures(html: string): string {
  return html.replace(signedLink, "$1");
}

/**
 * Whether two bodies' HTML differ in no more than the signatures of their
 * media links.
 */
export function sameExceptSignatures(before: string, now: string): boolean {
  return withoutSignatures(before) === withoutSignatures(now);
}

/** Whether GitHub's HTML links to media with signatures, which expire. */
export function hasSignedLinks(html: string): boolean {
  return withoutSignatures(html) !== html;
}

/**
 * A link to an image or video without its signature, which stays the same
 * however often GitHub signs it anew; any other link as it is.
 */
export function unsignedLink(url: string): string {
  const parsed = URL.parse(url);
  return parsed?.host === "private-user-images.githubusercontent.com"
    ? parsed.origin + parsed.pathname
    : url;
}
