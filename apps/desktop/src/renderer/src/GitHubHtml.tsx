import type { Problem } from "@verdandi/core/contract";
import { useLayoutEffect, useRef, useState } from "react";
import { followClick } from "./follow-link";
import { sanitizeGitHubHtml } from "./github-html";
import type { LinkToIssue } from "./link-target";
import { problemText } from "./problem-text";

const actionClass =
  "rounded px-1 underline-offset-2 hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring";

/**
 * GitHub's HTML for an issue's body or a comment, sanitized with Verdandi's
 * allowlist and styled like github.com. It is inserted anew only when the
 * HTML changed, so what shows stays as it is while the page is read again.
 * Its links are followed as `followClick` says. A linked issue that could
 * not be opened says why below it, with **Retry** and **Open on GitHub**.
 */
export function GitHubHtml({
  html,
  url,
  login,
  onOpenIssue,
}: {
  html: string;
  /** Where the body or comment is on github.com. */
  url: string;
  /** The account GitHub is read as, if known, to name it when unavailable. */
  login: string | undefined;
  /**
   * Opens a linked issue in the app, answering why it could not, if it
   * could not.
   */
  onOpenIssue: (link: LinkToIssue) => Promise<Problem | undefined>;
}) {
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    container.current?.replaceChildren(sanitizeGitHubHtml(html, document));
  }, [html]);
  const [failed, setFailed] = useState<{
    link: LinkToIssue;
    anchor: HTMLAnchorElement;
    problem: Problem;
  }>();

  function openIssue(link: LinkToIssue, anchor: HTMLAnchorElement) {
    setFailed(undefined);
    // The link shows it is being looked up.
    anchor.setAttribute("aria-busy", "true");
    void onOpenIssue(link).then((problem) => {
      anchor.removeAttribute("aria-busy");
      if (problem) setFailed({ link, anchor, problem });
    });
  }

  return (
    <>
      <div
        ref={container}
        className="markdown-body"
        onClick={(event) => {
          const handled = followClick(event.target, event.currentTarget, url, {
            openIssue,
            openExternal: window.desktop.openExternal,
          });
          if (handled) event.preventDefault();
        }}
        onAuxClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a")) {
            event.preventDefault();
          }
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
              openIssue(failed.link, failed.anchor);
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
