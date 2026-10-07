import type { Problem, RenewedMediaLinks } from "@verdandi/core/contract";
import { sameExceptSignatures } from "@verdandi/core/signed-links";
import { useLayoutEffect, useRef, useState } from "react";
import { followClick } from "./follow-link";
import { sanitizeGitHubHtml } from "./github-html";
import { ImageViewer, type ViewedImage } from "./ImageViewer";
import { IssueContextMenu, type IssueMenuTarget } from "./IssueContextMenu";
import { linkTarget, type LinkToIssue } from "./link-target";
import { followMedia } from "./media-loading";
import { opensInNewTab } from "./open-in-new-tab";
import { problemText } from "./problem-text";
import { loadThirdPartyImage } from "./third-party-images";

const actionClass =
  "rounded px-1 underline-offset-2 hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring";

/** An image in a body that opens in the viewer on a click or Enter. */
const viewableImage = 'img.media-image[role="button"]';

/**
 * GitHub's HTML for an issue's body or a comment, sanitized with Verdandi's
 * allowlist and styled like github.com. It is inserted anew only when the
 * HTML changed beyond the signatures of its media links, so what shows
 * stays as it is, videos playing on, while the page is read again. Its
 * links are followed as `followClick` says. A linked issue that could not
 * be opened says why below it, with **Retry** and **Open on GitHub**. A
 * middle click on it, or a click with ⌘ held (Ctrl elsewhere), opens it in
 * a new tab, as its right-click menu does, which also copies the link.
 *
 * Its images and videos load as `followMedia` says, and an image opens at
 * its full size in the viewer on a click or Enter.
 */
export function GitHubHtml({
  html,
  url,
  login,
  onOpenIssue,
  onRenewMedia,
}: {
  html: string;
  /** Where the body or comment is on github.com. */
  url: string;
  /** The account GitHub is read as, if known, to name it when unavailable. */
  login: string | undefined;
  /**
   * Opens a linked issue in the app, in this tab or a new one, answering
   * why it could not, if it could not.
   */
  onOpenIssue: (
    link: LinkToIssue,
    inNewTab: boolean,
  ) => Promise<Problem | undefined>;
  /**
   * Reads the body or comment again for fresh links to its media, after one
   * failed to load.
   */
  onRenewMedia: () => Promise<RenewedMediaLinks>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(html);
  if (html !== shown && !sameExceptSignatures(shown, html)) setShown(html);
  // The latest of these, for media that fail later.
  const latest = useRef({ onRenewMedia, login });
  useLayoutEffect(() => {
    latest.current = { onRenewMedia, login };
  });
  useLayoutEffect(() => {
    const body = container.current;
    if (!body) return;
    body.replaceChildren(sanitizeGitHubHtml(shown, document));
    return followMedia(body, {
      renew: () => latest.current.onRenewMedia(),
      describe: ({ problem }) =>
        problemText(problem, latest.current.login).text,
      loadImage: loadThirdPartyImage,
    });
  }, [shown]);
  const [viewed, setViewed] = useState<ViewedImage>();
  function view(image: HTMLImageElement) {
    setViewed({ src: image.src, alt: image.alt });
  }
  const [failed, setFailed] = useState<{
    link: LinkToIssue;
    anchor: HTMLAnchorElement;
    inNewTab: boolean;
    problem: Problem;
  }>();

  function openIssue(
    link: LinkToIssue,
    anchor: HTMLAnchorElement,
    inNewTab: boolean,
  ) {
    setFailed(undefined);
    // The link shows it is being looked up.
    anchor.setAttribute("aria-busy", "true");
    void onOpenIssue(link, inNewTab).then((problem) => {
      anchor.removeAttribute("aria-busy");
      if (problem) setFailed({ link, anchor, inNewTab, problem });
    });
  }

  /** What a right click on a link to an issue offers. */
  function menuTarget(element: Element): IssueMenuTarget | undefined {
    const anchor = element.closest("a");
    const href = anchor?.getAttribute("href");
    if (!anchor || !container.current?.contains(anchor) || !href)
      return undefined;
    const link = linkTarget(href);
    return link.kind === "issue"
      ? {
          openInNewTab: () => {
            openIssue(link, anchor, true);
          },
          url: href,
          link: href,
        }
      : undefined;
  }

  return (
    <>
      <IssueContextMenu targetAt={menuTarget}>
        <div
          ref={container}
          className="markdown-body"
          onClick={(event) => {
            // Media's own buttons, e.g. Retry, have been followed.
            if (event.defaultPrevented) return;
            const image =
              event.target instanceof Element
                ? event.target.closest<HTMLImageElement>(viewableImage)
                : null;
            if (image) {
              view(image);
              return;
            }
            const inNewTab = opensInNewTab(event);
            const handled = followClick(
              event.target,
              event.currentTarget,
              url,
              {
                openIssue: (link, anchor) => {
                  openIssue(link, anchor, inNewTab);
                },
                openExternal: window.desktop.openExternal,
              },
            );
            if (handled) event.preventDefault();
          }}
          onKeyDown={(event) => {
            const image = event.target;
            if (
              event.key !== "Enter" ||
              !(image instanceof HTMLImageElement) ||
              !image.matches(viewableImage)
            ) {
              return;
            }
            // Enter opens the image, rather than what the page's cursor is on.
            event.preventDefault();
            event.stopPropagation();
            view(image);
          }}
          onMouseDown={(event) => {
            // A middle click on a link opens it, rather than scrolling.
            if (
              event.button === 1 &&
              event.target instanceof Element &&
              event.target.closest("a")
            )
              event.preventDefault();
          }}
          onAuxClick={(event) => {
            const anchor =
              event.target instanceof Element
                ? event.target.closest("a")
                : null;
            if (!anchor) return;
            event.preventDefault();
            const link = linkTarget(anchor.getAttribute("href") ?? "");
            if (event.button === 1 && link.kind === "issue")
              openIssue(link, anchor, true);
          }}
        />
      </IssueContextMenu>
      <ImageViewer
        image={viewed}
        onClose={() => {
          setViewed(undefined);
        }}
      />
      {failed && (
        <p
          role="alert"
          title={problemText(failed.problem, login).detail}
          className="mt-2 text-xs text-warning"
        >
          Could not open {failed.link.repository.owner}/
          {failed.link.repository.name}#{failed.link.number} ·{" "}
          {problemText(failed.problem, login).text}{" "}
          <button
            type="button"
            className={actionClass}
            onClick={() => {
              openIssue(failed.link, failed.anchor, failed.inNewTab);
            }}
          >
            Retry
          </button>
          <button
            type="button"
            className={actionClass}
            onClick={() => {
              const href = failed.anchor.getAttribute("href");
              if (href !== null) window.desktop.openExternal(href);
            }}
          >
            Open on GitHub
          </button>
        </p>
      )}
    </>
  );
}
