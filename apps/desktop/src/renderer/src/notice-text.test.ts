import { describe, expect, it } from "vitest";
import { noticeText, noticeViews } from "./notice-text";

it("says which gh replaced the one the user chose", () => {
  expect(
    noticeText({
      kind: "gh-replaced",
      previous: "/opt/tools/gh",
      gh: { path: "/opt/homebrew/bin/gh", version: "2.101.0" },
    }),
  ).toBe(
    "The gh you chose at /opt/tools/gh is gone or no longer works. Verdandi now uses /opt/homebrew/bin/gh.",
  );
});

it("says which account GitHub is read as now, and that what shows is read again", () => {
  expect(
    noticeText({
      kind: "account-changed",
      previous: { login: "octo-reader", host: "github.com" },
      account: { login: "octo-writer", host: "github.com" },
    }),
  ).toBe(
    "gh switched from @octo-reader to @octo-writer. Verdandi now reads GitHub as @octo-writer and loads what it shows again.",
  );
});

const address = (nameWithOwner: string) => {
  const [owner = "", name = ""] = nameWithOwner.split("/");
  return { owner, name };
};

describe("renamed repositories", () => {
  it("says where a renamed or transferred repository is now", () => {
    expect(
      noticeText({
        kind: "repositories-renamed",
        renamed: [
          { from: address("acme/api"), to: address("newco/api"), views: [] },
        ],
      }),
    ).toBe("acme/api is now newco/api.");
  });

  it("names several renames found at once in one sentence", () => {
    const renamed = (from: string, to: string) => ({
      from: address(from),
      to: address(to),
      views: [],
    });
    expect(
      noticeText({
        kind: "repositories-renamed",
        renamed: [
          renamed("acme/api", "newco/api"),
          renamed("acme/web", "acme/website"),
        ],
      }),
    ).toBe("acme/api is now newco/api, and acme/web is now acme/website.");
    expect(
      noticeText({
        kind: "repositories-renamed",
        renamed: [
          renamed("a/one", "b/one"),
          renamed("a/two", "b/two"),
          renamed("a/three", "b/three"),
        ],
      }),
    ).toBe(
      "a/one is now b/one, a/two is now b/two, and a/three is now b/three.",
    );
  });

  it("offers the views whose search still names an old address, each once", () => {
    const bugs = { id: "bugs", name: "Bugs", query: "repo:acme/api" };
    const both = {
      id: "both",
      name: "Both",
      query: "repo:acme/api repo:acme/web",
    };
    expect(
      noticeViews({
        kind: "repositories-renamed",
        renamed: [
          {
            from: address("acme/api"),
            to: address("newco/api"),
            views: [bugs, both],
          },
        ],
      }),
    ).toEqual({
      label: "Views still searching repo:acme/api:",
      views: [bugs, both],
    });
    expect(
      noticeViews({
        kind: "repositories-renamed",
        renamed: [
          {
            from: address("acme/api"),
            to: address("newco/api"),
            views: [both],
          },
          {
            from: address("acme/web"),
            to: address("newco/web"),
            views: [both],
          },
        ],
      }),
    ).toEqual({
      label: "Views still searching an old address:",
      views: [both],
    });
    expect(
      noticeViews({
        kind: "repositories-renamed",
        renamed: [
          { from: address("acme/api"), to: address("newco/api"), views: [] },
        ],
      }),
    ).toBeUndefined();
  });
});

it("says which duplicate entries of settings.json were removed, and which stayed", () => {
  expect(
    noticeText({
      kind: "duplicate-repositories-removed",
      removed: [
        { repository: address("newco/api"), sameAs: address("acme/api") },
      ],
    }),
  ).toBe(
    "newco/api was removed from the sidebar: settings.json listed it as the same repository as acme/api.",
  );
});
