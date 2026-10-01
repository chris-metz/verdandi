import { unsignedLink } from "@verdandi/core/signed-links";

/**
 * Where the images and videos of issue bodies load from (ADR 0003). The
 * renderer loads them itself, but only from GitHub's media hosts, which the
 * window's Content Security Policy names too: uploads, signed or legacy, and
 * third-party images through GitHub's Camo proxy. Anything else never loads
 * on its own.
 */

/** GitHub's hosts that images load from, as the CSP's `img-src` names them. */
export const imageHosts = [
  "private-user-images.githubusercontent.com",
  "user-images.githubusercontent.com",
  "camo.githubusercontent.com",
] as const;

/**
 * GitHub's hosts that videos load from, as the CSP's `media-src` names
 * them: uploads only, as Camo proxies no videos.
 */
export const videoHosts = [
  "private-user-images.githubusercontent.com",
  "user-images.githubusercontent.com",
] as const;

/**
 * Where an image or video in a body loads from:
 *
 * - `github`: one of GitHub's media hosts, at once;
 * - `third-party`: another `https://` address, only once the user asks;
 * - `none`: nowhere, e.g. an address of another scheme.
 */
export type MediaSource =
  | { kind: "github"; url: string }
  | { kind: "third-party"; url: string }
  | { kind: "none" };

/** Where an image or video loads from, by its `src`. */
export function mediaSource(kind: "image" | "video", src: string): MediaSource {
  // GitHub's addresses are absolute; others are relative to github.com.
  const url = src.trim() ? URL.parse(src.trim(), "https://github.com/") : null;
  if (url?.protocol !== "https:" || url.username || url.password) {
    return { kind: "none" };
  }
  const hosts: readonly string[] = kind === "image" ? imageHosts : videoHosts;
  if (hosts.includes(url.host)) return { kind: "github", url: url.href };
  return kind === "image"
    ? { kind: "third-party", url: url.href }
    : { kind: "none" };
}

/** A file attached to a body, which opens in the browser. */
export interface Attachment {
  /** Its filename, when its address names it. */
  name: string | undefined;
}

/**
 * Where GitHub keeps attached files on github.com: `/user-attachments/files/
 * <n>/<name>` and, earlier, `/<owner>/<repo>/files/<n>/<name>`, whose
 * filename is known; and `/user-attachments/assets/<uuid>` for an upload
 * linked to rather than shown, whose is not.
 */
const attachmentPaths = [
  /^\/user-attachments\/files\/\d+\/([^/]+)$/,
  /^\/[\w.-]+\/[\w.-]+\/files\/\d+\/([^/]+)$/,
  /^\/user-attachments\/assets\/[\w-]+$/,
];

/** The file a link in a body leads to, by its `href`, if it is one. */
export function attachmentOf(href: string): Attachment | undefined {
  const url = URL.parse(href);
  if (url?.protocol !== "https:" || url.host !== "github.com") return undefined;
  for (const path of attachmentPaths) {
    const match = path.exec(url.pathname);
    if (!match) continue;
    const [, name] = match;
    if (name === undefined) return { name: undefined };
    try {
      return { name: decodeURIComponent(name) };
    } catch {
      return { name };
    }
  }
  return undefined;
}

/**
 * The link to an image or video that failed to load in its body's HTML as
 * read again: signed anew, if GitHub signs it, or as it was; none once the
 * body no longer shows it.
 */
export function freshLink(failed: string, html: string): string | undefined {
  const address = unsignedLink(failed);
  const source = new DOMParser().parseFromString(html, "text/html");
  for (const medium of source.querySelectorAll("img[src], video[src]")) {
    const src = medium.getAttribute("src") ?? "";
    const url = URL.parse(src.trim(), "https://github.com/")?.href;
    if (url !== undefined && unsignedLink(url) === address) return url;
  }
  return undefined;
}
