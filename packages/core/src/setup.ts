import { isDeepStrictEqual } from "node:util";
import type { Account, GhChoice, Notice, Setup } from "./contract.ts";
import type { HostEnvironment } from "./directories.ts";
import type { CommandRunner } from "./github/command-runner.ts";
import { describeGitHubError } from "./github/error-message.ts";
import { findGh, probeGh } from "./github/gh-discovery.ts";
import type { GitHubAccess, GitHubError } from "./github/port.ts";
import type { LocalStateStorage } from "./settings/port.ts";

/**
 * Whether Verdandi can read GitHub, kept up to date: the gate every GitHub
 * request passes. It finds gh and asks it about its credentials at startup,
 * on **Check again**, when the user chooses gh, and after a request failed in
 * a way that suggests gh or its credentials stopped working. Only a confirmed
 * failure blocks: gh missing or unusable, or `gh auth status` confirming that
 * the credentials are missing or rejected. Checks run one after another.
 */
export interface GhSetup {
  /** The setup as far as it has been checked, starting the first check. */
  current(): Setup;
  /**
   * GitHub access through the gh found, once the setup is ready; while it is
   * checked for the first time or blocked, this waits.
   */
  access(): Promise<GitHubAccess>;
  /** Checks the setup again, after any check under way. */
  checkAgain(): Promise<Setup>;
  /**
   * Uses a gh the user chose, if it is usable, remembering it on this
   * machine, and checks the setup with it.
   */
  choose(file: string): Promise<GhChoice>;
  /**
   * Takes the error of a failed GitHub request, and checks the setup if it
   * suggests that gh or its credentials stopped working.
   */
  requestFailed(error: GitHubError): void;
}

export interface GhSetupOptions {
  /** Runs the gh executables found or chosen, to check them. */
  runCommand: CommandRunner;
  /** Where gh is looked for. */
  host: HostEnvironment;
  /** Where the user's choice of gh is kept. */
  localState: LocalStateStorage;
  /** GitHub access through the gh executable at a path. */
  github: (gh: string) => GitHubAccess;
  /** Pushes the setup to the interfaces whenever it changes. */
  push: (setup: Setup) => void;
  /** Tells the user something briefly. */
  notify: (notice: Notice) => void;
  /** Takes the end of a blocker: the setup is ready again. */
  recovered: () => void;
  /** Takes another account than gh signed in as before. */
  accountChanged: (account: Account) => void;
}

export function createGhSetup({
  runCommand,
  host,
  localState,
  github,
  push,
  notify,
  recovered,
  accountChanged,
}: GhSetupOptions): GhSetup {
  let setup: Setup = { status: "checking" };
  /** The checks under way and waiting, the last one last. */
  let checks: Promise<Setup> | undefined;
  /** Settles with GitHub access as the setup becomes ready. */
  let ready = Promise.withResolvers<GitHubAccess>();
  /** GitHub access through each gh executable used, by path. */
  const accesses = new Map<string, GitHubAccess>();
  /**
   * The gh the user chose, once machine-local state has been read; it is
   * kept here, too, so that a failure to write it costs only its memory
   * across restarts.
   */
  let chosen: { path: string | undefined } | undefined;
  let knownLogin: string | undefined;

  function accessTo(gh: string): GitHubAccess {
    let access = accesses.get(gh);
    if (!access) {
      access = github(gh);
      accesses.set(gh, access);
    }
    return access;
  }

  /** Keeps the user's choice of gh, here and on this machine. */
  async function remember(path: string | undefined) {
    chosen = { path };
    // Machine-local state is a convenience: without it, gh is found again.
    await localState.update({ ghExecutable: path }).catch(() => undefined);
  }

  /** Runs a step, then a check, after every check under way. */
  function enqueue(before: () => Promise<void> = async () => {}) {
    const check = (checks ?? Promise.resolve()).then(async () => {
      await before();
      return apply(await checkNow());
    });
    checks = check;
    void check.finally(() => {
      if (checks === check) checks = undefined;
    });
    return check;
  }

  /** Finds gh, then asks it about its credentials. */
  async function checkNow(): Promise<Setup> {
    chosen ??= { path: (await localState.read()).ghExecutable };
    const previous = chosen.path;
    const { gh, notUsable } = await findGh({
      runCommand,
      host,
      chosen: previous,
    });
    if (!gh) {
      return {
        status: "blocked",
        problem: { kind: "no-usable-gh", notUsable },
      };
    }
    if (previous !== undefined && gh.path !== previous) {
      await remember(undefined);
      notify({ kind: "gh-replaced", previous, gh });
    }
    const status = await accessTo(gh.path).fetchAuthStatus();
    if (!status.ok) {
      const { error } = status;
      if (error.kind === "gh-signed-out") {
        return { status: "blocked", problem: { kind: "signed-out", gh } };
      }
      // It went missing or unusable since it answered its version.
      if (error.kind === "gh-not-found" || error.kind === "gh-unusable") {
        const reason = describeGitHubError(error);
        return {
          status: "blocked",
          problem: {
            kind: "no-usable-gh",
            notUsable: [...notUsable, { path: gh.path, reason }],
          },
        };
      }
      const message = describeGitHubError(error);
      return {
        status: "ready",
        gh,
        account: { status: "unconfirmed", message },
      };
    }
    const auth = status.value;
    switch (auth.state) {
      case "signed-in":
        return {
          status: "ready",
          gh,
          account: {
            status: "known",
            account: { login: auth.login, host: "github.com" },
            tokenSource: auth.tokenSource,
          },
        };
      case "signed-out":
        return { status: "blocked", problem: { kind: "signed-out", gh } };
      case "rejected":
        return {
          status: "blocked",
          problem: {
            kind: "credentials-rejected",
            gh,
            login: auth.login,
            tokenSource: auth.tokenSource,
          },
        };
    }
  }

  /** Takes a check's outcome as the setup, and says what changed. */
  function apply(next: Setup): Setup {
    const previous = setup;
    setup = next;
    if (!isDeepStrictEqual(previous, next)) push(next);
    if (next.status !== "ready") {
      if (previous.status === "ready") ready = Promise.withResolvers();
      return next;
    }
    ready.resolve(accessTo(next.gh.path));
    if (next.account.status === "known") {
      const { account } = next.account;
      if (knownLogin !== undefined && knownLogin !== account.login) {
        accountChanged(account);
      }
      knownLogin = account.login;
    }
    if (previous.status === "blocked") recovered();
    return next;
  }

  /** Starts the first check, unless one has started. */
  function start() {
    if (setup.status === "checking" && !checks) void enqueue();
  }

  return {
    current() {
      start();
      return setup;
    },
    access() {
      start();
      return setup.status === "ready"
        ? Promise.resolve(accessTo(setup.gh.path))
        : ready.promise;
    },
    checkAgain() {
      return enqueue();
    },
    async choose(file) {
      const probe = await probeGh(runCommand, file, host.platform);
      if (!probe.usable) {
        return { status: "invalid", path: file, reason: probe.reason };
      }
      return {
        status: "chosen",
        setup: await enqueue(() => remember(file)),
      };
    },
    requestFailed(error) {
      // A check under way, or the blocker, will tell.
      if (setup.status === "ready" && !checks && suspectsSetup(error)) {
        void enqueue();
      }
    },
  };
}

/**
 * Whether a failed request suggests that gh or its credentials stopped
 * working, for a check to confirm or not: gh missing or unusable, signed out,
 * or GitHub answering HTTP 401. Nothing else ever raises the blocker, such as
 * 403 (SSO included), 404, 410, rate limits, network failures, server errors
 * or timeouts: those stay with the content they concern.
 */
function suspectsSetup(error: GitHubError): boolean {
  switch (error.kind) {
    case "gh-not-found":
    case "gh-unusable":
    case "gh-signed-out":
      return true;
    case "http":
      return error.status === 401;
    case "gh-failed":
    case "unavailable":
    case "rate-limited":
    case "server-error":
    case "graphql":
    case "unexpected-response":
      return false;
  }
}
