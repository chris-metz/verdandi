import type { GhExecutable } from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import { setupGuidance } from "./setup-guidance";

const gh: GhExecutable = { path: "/opt/homebrew/bin/gh", version: "2.101.0" };

const installation = {
  label: "Installation instructions",
  url: "https://github.com/cli/cli#installation",
};

describe("setup guidance when gh is not found", () => {
  it("installs gh with Homebrew on macOS and says how to find a gh that works in the terminal", () => {
    expect(
      setupGuidance({ kind: "no-usable-gh", notUsable: [] }, "darwin"),
    ).toEqual({
      title: "GitHub CLI not found",
      explanation: [
        "Verdandi reads GitHub through GitHub CLI (gh), and could not find a gh it can use.",
        "Install gh, sign in with gh auth login, then choose Check again.",
      ],
      commands: [
        { label: "Install with Homebrew", command: "brew install gh" },
        { label: "Sign in", command: "gh auth login --hostname github.com" },
      ],
      links: [installation],
      terminalHint: {
        explanation:
          "Apps started from the Dock or Finder may not look where your terminal does. Find gh in your terminal, then choose that file with Choose gh executable….",
        command: "command -v gh",
      },
      primary: "choose",
    });
  });

  it("installs gh with winget on Windows, and finds it with where.exe", () => {
    const guidance = setupGuidance(
      { kind: "no-usable-gh", notUsable: [] },
      "win32",
    );

    expect(guidance.commands[0]).toEqual({
      label: "Install with winget",
      command: "winget install --id GitHub.cli",
    });
    expect(guidance.terminalHint.command).toBe("where.exe gh");
    expect(guidance.terminalHint.explanation).toContain("Start menu");
  });

  it("links the Linux instructions, since distributions install gh differently", () => {
    const guidance = setupGuidance(
      { kind: "no-usable-gh", notUsable: [] },
      "linux",
    );

    expect(guidance.commands).toEqual([
      { label: "Sign in", command: "gh auth login --hostname github.com" },
    ]);
    expect(guidance.links).toEqual([
      {
        label: "Installing gh on Linux",
        url: "https://github.com/cli/cli/blob/trunk/docs/install_linux.md",
      },
      installation,
    ]);
    expect(guidance.terminalHint.explanation).toContain("desktop entry");
  });
});

describe("setup guidance for gh's credentials", () => {
  it("asks to sign in in a terminal, then Check again, when gh is signed out", () => {
    expect(setupGuidance({ kind: "signed-out", gh }, "darwin")).toMatchObject({
      title: "Sign in to GitHub",
      explanation: [
        "GitHub CLI is installed but not signed in to github.com. Sign in in a terminal, then choose Check again. Verdandi never signs in itself.",
      ],
      commands: [
        { label: "Sign in", command: "gh auth login --hostname github.com" },
      ],
      links: [],
      primary: "check",
    });
  });

  it("names the account whose stored credentials GitHub rejected", () => {
    expect(
      setupGuidance(
        {
          kind: "credentials-rejected",
          gh,
          login: "octo-reader",
          tokenSource: "stored",
        },
        "darwin",
      ),
    ).toMatchObject({
      title: "GitHub rejected gh's sign-in",
      explanation: [
        "GitHub no longer accepts gh's credentials for @octo-reader on github.com, e.g. because the token expired or was revoked. Sign in again in a terminal, then choose Check again.",
      ],
      commands: [
        { label: "Sign in", command: "gh auth login --hostname github.com" },
      ],
      primary: "check",
    });
  });

  it("explains a rejected token from GITHUB_TOKEN: gh's own sign-in does not change it", () => {
    expect(
      setupGuidance(
        {
          kind: "credentials-rejected",
          gh,
          login: undefined,
          tokenSource: "GITHUB_TOKEN",
        },
        "linux",
      ),
    ).toMatchObject({
      title: "GitHub rejected the token in GITHUB_TOKEN",
      explanation: [
        "Verdandi was started with GITHUB_TOKEN set, so gh reads github.com with that token instead of the account it has stored, and GitHub rejected it.",
        "Signing in or switching accounts in gh, e.g. with gh auth login or gh auth switch, does not change this. Change or remove GITHUB_TOKEN where Verdandi is started, then restart Verdandi.",
      ],
      commands: [],
      primary: "check",
    });
  });
});
