import type { SetupProblem } from "@verdandi/core/contract";
import type { Platform } from "../../shared/ipc";

/** A command to copy and run in a terminal. */
export interface GuidanceCommand {
  label: string;
  command: string;
}

/** A page to open in the browser. */
export interface GuidanceLink {
  label: string;
  url: string;
}

/**
 * What the setup blocker says about a problem, and what it offers. Verdandi
 * never installs gh or signs in: the user does, in a terminal, then chooses
 * **Check again**.
 */
export interface SetupGuidance {
  title: string;
  /** Paragraphs saying what is wrong and what to do. */
  explanation: string[];
  commands: GuidanceCommand[];
  links: GuidanceLink[];
  /**
   * For a gh that works in the terminal but was not found: how to find it
   * there, to choose it.
   */
  terminalHint: { explanation: string; command: string };
  /** The action offered first: choosing gh, or checking again. */
  primary: "choose" | "check";
}

const signIn: GuidanceCommand = {
  label: "Sign in",
  command: "gh auth login --hostname github.com",
};

const installation: GuidanceLink = {
  label: "Installation instructions",
  url: "https://github.com/cli/cli#installation",
};

/** The guidance for a setup problem on an operating system. */
export function setupGuidance(
  problem: SetupProblem,
  platform: Platform,
): SetupGuidance {
  const terminalHint = terminalHintFor(platform);
  switch (problem.kind) {
    case "no-usable-gh":
      return {
        title: "GitHub CLI not found",
        explanation: [
          "Verdandi reads GitHub through GitHub CLI (gh), and could not find a gh it can use.",
          "Install gh, sign in with gh auth login, then choose Check again.",
        ],
        commands: [...installCommands(platform), signIn],
        links:
          platform === "linux"
            ? [
                {
                  label: "Installing gh on Linux",
                  url: "https://github.com/cli/cli/blob/trunk/docs/install_linux.md",
                },
                installation,
              ]
            : [installation],
        terminalHint,
        primary: "choose",
      };
    case "signed-out":
      return {
        title: "Sign in to GitHub",
        explanation: [
          "GitHub CLI is installed but not signed in to github.com. Sign in in a terminal, then choose Check again. Verdandi never signs in itself.",
        ],
        commands: [signIn],
        links: [],
        terminalHint,
        primary: "check",
      };
    case "credentials-rejected": {
      const { tokenSource, login } = problem;
      if (tokenSource !== "stored") {
        return {
          title: `GitHub rejected the token in ${tokenSource}`,
          explanation: [
            `Verdandi was started with ${tokenSource} set, so gh reads github.com with that token instead of the account it has stored, and GitHub rejected it.`,
            `Signing in or switching accounts in gh, e.g. with gh auth login or gh auth switch, does not change this. Change or remove ${tokenSource} where Verdandi is started, then restart Verdandi.`,
          ],
          commands: [],
          links: [],
          terminalHint,
          primary: "check",
        };
      }
      const account = login === undefined ? "" : ` for @${login}`;
      return {
        title: "GitHub rejected gh's sign-in",
        explanation: [
          `GitHub no longer accepts gh's credentials${account} on github.com, e.g. because the token expired or was revoked. Sign in again in a terminal, then choose Check again.`,
        ],
        commands: [signIn],
        links: [],
        terminalHint,
        primary: "check",
      };
    }
  }
}

/** One command that installs gh, where the platform has one. */
function installCommands(platform: Platform): GuidanceCommand[] {
  switch (platform) {
    case "darwin":
      return [{ label: "Install with Homebrew", command: "brew install gh" }];
    case "win32":
      return [
        {
          label: "Install with winget",
          command: "winget install --id GitHub.cli",
        },
      ];
    case "linux":
      return [];
  }
}

function terminalHintFor(platform: Platform): SetupGuidance["terminalHint"] {
  const launchedFrom = {
    darwin: "the Dock or Finder",
    win32: "the Start menu",
    linux: "a desktop entry",
  }[platform];
  return {
    explanation: `Apps started from ${launchedFrom} may not look where your terminal does. Find gh in your terminal, then choose that file with Choose gh executable….`,
    command: platform === "win32" ? "where.exe gh" : "command -v gh",
  };
}
