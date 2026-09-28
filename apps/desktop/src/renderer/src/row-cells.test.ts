import type { Label } from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import {
  colorStyle,
  incompleteTitle,
  labelColors,
  labelOverflow,
  ownerColors,
  progressCell,
  relationshipCell,
  repositoryChipCell,
  unreadCell,
} from "./row-cells";

const labels: Label[] = [
  { name: "bug", color: "d73a4a" },
  { name: "api", color: "0075ca" },
  { name: "security", color: "b60205" },
  { name: "docs", color: "0075ca" },
  { name: "needs design", color: "fef2c0" },
];

describe("labels", () => {
  it("show up to three", () => {
    expect(labelOverflow(labels.slice(0, 3))).toEqual({
      shown: labels.slice(0, 3),
      more: undefined,
    });
    expect(labelOverflow([])).toEqual({ shown: [], more: undefined });
  });

  it("count the rest as +N, naming them for the tooltip", () => {
    expect(labelOverflow(labels)).toEqual({
      shown: labels.slice(0, 3),
      more: { count: 2, names: "docs, needs design" },
    });
  });

  it("show GitHub's colour, with text that stays readable on it", () => {
    expect(labelColors("d73a4a")).toEqual({
      background: "#d73a4a",
      foreground: "#ffffff",
    });
    expect(labelColors("a2eeef")).toEqual({
      background: "#a2eeef",
      foreground: "#1f2328",
    });
  });

  it("fall back to grey for a colour that is not six hex digits", () => {
    expect(labelColors("red; background: url(x)")).toEqual({
      background: "#ededed",
      foreground: "#1f2328",
    });
  });
});

describe("sub-issue progress", () => {
  it("shows the closed share and closed/total", () => {
    expect(progressCell({ closed: 1, total: 4 })).toEqual({
      fraction: 0.25,
      text: "1/4",
    });
  });

  it("stays empty without sub-issues", () => {
    expect(progressCell({ closed: 0, total: 0 })).toBeUndefined();
  });
});

describe("blocking columns", () => {
  it("count open relationships of an open issue", () => {
    expect(
      relationshipCell("blockedBy", "open", { open: 2, total: 3 }),
    ).toEqual({ live: true, text: "2" });
    expect(relationshipCell("blocking", "open", { open: 1, total: 1 })).toEqual(
      { live: true, text: "1" },
    );
  });

  it("show open/total, muted, when none is live", () => {
    expect(
      relationshipCell("blockedBy", "open", { open: 0, total: 2 }),
    ).toEqual({ live: false, text: "0/2" });
    expect(relationshipCell("blocking", "open", { open: 0, total: 1 })).toEqual(
      { live: false, text: "0/1" },
    );
    // A closed issue no longer waits, but its blockers may still be open.
    expect(
      relationshipCell("blockedBy", "closed", { open: 1, total: 1 }),
    ).toEqual({ live: false, text: "1/1" });
  });

  it("show nothing waiting on a closed issue", () => {
    expect(
      relationshipCell("blocking", "closed", { open: 1, total: 2 }),
    ).toEqual({ live: false, text: "0/2" });
  });

  it("stay empty without relationships", () => {
    expect(
      relationshipCell("blockedBy", "open", { open: 0, total: 0 }),
    ).toBeUndefined();
    expect(
      relationshipCell("blocking", "closed", { open: 0, total: 0 }),
    ).toBeUndefined();
  });
});

describe("colour pairs", () => {
  it("style an element's background and text", () => {
    expect(
      colorStyle({ background: "#d73a4a", foreground: "#ffffff" }),
    ).toEqual({ backgroundColor: "#d73a4a", color: "#ffffff" });
  });
});

describe("repository chips", () => {
  it("name a tracked repository, in its owner's colour", () => {
    const api = repositoryChipCell({
      repository: { owner: "acme", name: "api" },
      external: false,
    });
    const web = repositoryChipCell({
      repository: { owner: "acme", name: "web" },
      external: false,
    });

    expect(api).toEqual({
      text: "api",
      title: "acme/api",
      colors: ownerColors("acme"),
    });
    expect(web.colors).toEqual(api.colors);
  });

  it("name an external repository in full, outlined instead of filled", () => {
    expect(
      repositoryChipCell({
        repository: { owner: "vendor", name: "sdk" },
        external: true,
      }),
    ).toEqual({
      text: "vendor/sdk",
      title: "vendor/sdk is not a tracked repository",
      colors: undefined,
    });
  });
});

describe("owner colours", () => {
  const owners = Array.from(
    { length: 200 },
    (_, index) => `owner-${String(index)}`,
  );

  it("stay the same for an owner, whatever the case of its name", () => {
    expect(ownerColors("Octo-Org")).toEqual(ownerColors("octo-org"));
  });

  it("tell owners apart", () => {
    const backgrounds = new Set(
      owners.map((owner) => ownerColors(owner).background),
    );
    expect(backgrounds.size).toBeGreaterThanOrEqual(10);
  });

  it("keep the chip's text readable, in light and dark alike", () => {
    // WCAG 2 AA asks for 4.5:1 for small text. The chip is filled, so the
    // window's background does not matter.
    for (const owner of owners) {
      const { background, foreground } = ownerColors(owner);
      expect(contrast(background, foreground)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/** The WCAG 2 contrast ratio of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("a row for an issue that has not been read", () => {
  it("says it is loading", () => {
    expect(unreadCell({ status: "loading" }, "octo-reader")).toEqual({
      text: "Loading…",
      title: undefined,
      failed: false,
      link: undefined,
    });
  });

  it("says it could not be loaded, with why in its tooltip", () => {
    expect(
      unreadCell(
        {
          status: "failed",
          problem: { kind: "unreachable", message: "no such host" },
        },
        "octo-reader",
      ),
    ).toEqual({
      text: "Could not be loaded",
      title: "Cannot reach GitHub: no such host",
      failed: true,
      link: undefined,
    });
  });

  it("says GitHub will not show it to the account, with GitHub's reason and link when it gave them", () => {
    const url = "https://github.com/orgs/acme/sso?authorization_request=A1";
    expect(
      unreadCell(
        {
          status: "failed",
          problem: {
            kind: "unavailable",
            access: { kind: "sso", message: "SAML enforcement", url },
          },
        },
        "octo-reader",
      ),
    ).toEqual({
      text: "Unavailable or not accessible with this account (@octo-reader)",
      title: "SAML enforcement",
      failed: true,
      link: { label: "Authorize on GitHub", url },
    });
  });
});

describe("an issue GitHub showed only in part", () => {
  it("says so, with why", () => {
    expect(
      incompleteTitle({
        kind: "unavailable",
        access: {
          kind: "organization-approval",
          message: "OAuth App access restrictions",
        },
      }),
    ).toBe(
      "Shown in part: Unavailable or not accessible with this account. OAuth App access restrictions",
    );
  });
});
