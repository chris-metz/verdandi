import type { IssueLookup } from "@verdandi/core/contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { followClick, openLinkToIssue, type LinkActions } from "./follow-link";
import { sanitizeGitHubHtml } from "./github-html";

/** A comment's body as Verdandi shows it, in the document. */
function body(html: string): HTMLElement {
  const element = document.createElement("div");
  element.append(sanitizeGitHubHtml(html, document));
  document.body.replaceChildren(element);
  return element;
}

const commentUrl = "https://github.com/acme/api/issues/1#issuecomment-7";

function actions() {
  return {
    openIssue: vi.fn<LinkActions["openIssue"]>(),
    openExternal: vi.fn<LinkActions["openExternal"]>(),
  };
}

describe("a click in an issue's body", () => {
  /** Scrolls an element into view, which jsdom cannot, as it lays nothing out. */
  let scrolledTo = vi.fn<(this: Element) => void>();
  beforeEach(() => {
    scrolledTo = vi.fn<(this: Element) => void>();
    Element.prototype.scrollIntoView = scrolledTo;
  });

  it("opens a linked issue in the app", () => {
    const shown = body(
      '<p>See <a class="issue-link" href="https://github.com/other/lib/issues/5"><span>other/lib#5</span></a></p>',
    );
    const act = actions();

    const handled = followClick(
      shown.querySelector("span"),
      shown,
      commentUrl,
      act,
    );

    expect(handled).toBe(true);
    expect(act.openIssue).toHaveBeenCalledWith(
      {
        kind: "issue",
        repository: { owner: "other", name: "lib" },
        number: 5,
      },
      shown.querySelector("a"),
    );
    expect(act.openExternal).not.toHaveBeenCalled();
  });

  it("opens any other https: link in the browser", () => {
    const shown = body('<p><a href="https://example.com/docs">Docs</a></p>');
    const act = actions();

    expect(followClick(shown.querySelector("a"), shown, commentUrl, act)).toBe(
      true,
    );
    expect(act.openExternal).toHaveBeenCalledWith("https://example.com/docs");
  });

  it.each([
    '<a href="javascript:alert(1)">x</a>',
    '<a href="http://example.com">x</a>',
    '<a href="mailto:octo@example.com">x</a>',
  ])("never opens %s, nor lets the window follow it", (html) => {
    const shown = body(`<p>${html}</p>`);
    const act = actions();

    expect(followClick(shown.querySelector("a"), shown, commentUrl, act)).toBe(
      true,
    );
    expect(act.openExternal).not.toHaveBeenCalled();
    expect(act.openIssue).not.toHaveBeenCalled();
  });

  it("scrolls to a footnote in the same body", () => {
    const shown = body(
      '<p>Claim<sup><a href="#user-content-fn-1" id="user-content-fnref-1">1</a></sup></p><section class="footnotes"><ol><li id="user-content-fn-1">Source</li></ol></section>',
    );
    const act = actions();

    followClick(shown.querySelector("sup a"), shown, commentUrl, act);

    expect(scrolledTo).toHaveBeenCalledOnce();
    expect(scrolledTo.mock.contexts[0]).toBe(shown.querySelector("li"));
  });

  it("scrolls to a heading GitHub links to without its prefix", () => {
    const shown = body(
      '<p><a href="#steps">Steps</a></p><div class="markdown-heading"><h2>Steps</h2><a id="user-content-steps" class="anchor" href="#steps"></a></div>',
    );

    followClick(shown.querySelector("a"), shown, commentUrl, actions());

    expect(scrolledTo.mock.contexts[0]).toBe(shown.querySelector("h2"));
  });

  it("opens the comment on GitHub from beside a block github.com renders itself", () => {
    const shown = body(
      '<section class="js-render-needs-enrichment" data-type="mermaid"><div data-plain="graph TD;"></div></section>',
    );
    const act = actions();

    expect(
      followClick(shown.querySelector("button"), shown, commentUrl, act),
    ).toBe(true);
    expect(act.openExternal).toHaveBeenCalledWith(commentUrl);
  });

  it("leaves a click elsewhere alone", () => {
    const shown = body("<p>Just <strong>text</strong></p>");
    const act = actions();

    expect(
      followClick(shown.querySelector("strong"), shown, commentUrl, act),
    ).toBe(false);
    expect(act.openExternal).not.toHaveBeenCalled();
  });
});

describe("opening a linked issue", () => {
  const link = {
    kind: "issue",
    repository: { owner: "other", name: "lib" },
    number: 5,
  } as const;

  function openWith(found: IssueLookup) {
    const open = vi.fn();
    const openExternal = vi.fn();
    const result = openLinkToIssue(link, () => Promise.resolve(found), {
      open,
      openExternal,
    });
    return { result, open, openExternal };
  }

  it("opens the issue's page once it is found", async () => {
    const issue = {
      id: "I_5",
      reference: "other/lib#5",
      title: "Leaks memory",
      url: "https://github.com/other/lib/issues/5",
    };
    const { result, open } = openWith({ status: "found", issue });

    expect(await result).toBeUndefined();
    expect(open).toHaveBeenCalledWith(issue);
  });

  it("opens a pull request in the browser", async () => {
    const url = "https://github.com/other/lib/pull/5";
    const { result, openExternal } = openWith({ status: "pull-request", url });

    expect(await result).toBeUndefined();
    expect(openExternal).toHaveBeenCalledWith(url);
  });

  it("says why an issue could not be found, opening nothing", async () => {
    const problem = { kind: "unavailable", access: undefined } as const;
    const { result, open, openExternal } = openWith({
      status: "failed",
      problem,
    });

    expect(await result).toEqual(problem);
    expect(open).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("says nothing when the lookup was dropped, e.g. for another account", async () => {
    const { result } = openWith({
      status: "failed",
      problem: { kind: "interrupted" },
    });

    expect(await result).toBeUndefined();
  });
});
