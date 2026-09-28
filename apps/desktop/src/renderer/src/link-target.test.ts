import { describe, expect, it } from "vitest";
import { linkTarget } from "./link-target";

describe("where a link in an issue's body leads", () => {
  it.each([
    "https://github.com/acme/api/issues/12",
    "https://github.com/acme/api/issues/12/",
    "https://github.com/acme/api/issues/12#issuecomment-3000000001",
    "https://github.com/acme/api/issues/12?reload=1",
    "https://GitHub.com/acme/api/issues/12",
    "https://www.github.com/acme/api/issues/12",
  ])("opens the issue %s in the app", (href) => {
    expect(linkTarget(href)).toEqual({
      kind: "issue",
      repository: { owner: "acme", name: "api" },
      number: 12,
    });
  });

  it("opens an issue in a repository with dots and dashes in its name in the app", () => {
    expect(
      linkTarget("https://github.com/octo-org/web.site_v2/issues/7"),
    ).toEqual({
      kind: "issue",
      repository: { owner: "octo-org", name: "web.site_v2" },
      number: 7,
    });
  });

  it.each([
    "https://github.com/acme/api/pull/3",
    "https://github.com/acme/api/issues",
    "https://github.com/acme/api/issues/new",
    "https://github.com/acme/api/issues/12/timeline",
    "https://github.com/octo-dev",
    "https://gist.github.com/acme/api/issues/12",
    "https://github.com.evil.example/acme/api/issues/12",
    "https://example.com/acme/api/issues/12",
  ])("opens %s in the browser", (href) => {
    expect(linkTarget(href)).toEqual({ kind: "external", url: href });
  });

  it.each([
    ["#user-content-fn-1", "user-content-fn-1"],
    ["#steps", "steps"],
  ])("follows %s within the body", (href, id) => {
    expect(linkTarget(href)).toEqual({ kind: "anchor", id });
  });

  it.each([
    "http://example.com",
    "mailto:octo@example.com",
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "/acme/api",
    "not a link",
    "#",
  ])("never opens %s", (href) => {
    expect(linkTarget(href)).toEqual({ kind: "none" });
  });
});
