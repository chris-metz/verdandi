import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Contract,
  IssueList,
  IssueNode,
  IssuePage,
  IssueSummary,
  Notice,
  RateLimitState,
  Scope,
  Setup,
  SidebarEntries,
} from "./contract.ts";
import { createCore } from "./core.ts";
import type { HostEnvironment } from "./directories.ts";
import type { CommandResult, CommandRunner } from "./github/command-runner.ts";
import type { GitHubError } from "./github/port.ts";
import { createLocalStateFile } from "./settings/local-state-file.ts";
import { createSettingsFile } from "./settings/settings-file.ts";
import { createFakeGitHub, type FakeGitHub } from "./testing/fake-github.ts";

/** A temporary `VERDANDI_HOME`, so tests never touch the real user data. */
let home: string;
const cores: ReturnType<typeof createCore>[] = [];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "verdandi-test-"));
});

afterEach(async () => {
  for (const core of cores.splice(0)) core.dispose();
  await rm(home, { recursive: true, force: true });
});

/** Writes `settings.json` as the user would, by hand. */
async function writeSettings(settings: unknown) {
  await writeFile(join(home, "settings.json"), JSON.stringify(settings));
}

/** When every test starts, by its clock. */
const startTime = Date.parse("2026-09-27T12:00:00Z");

/** One minute, in the clock's milliseconds. */
const minute = 60 * 1000;

/** A clock that stands still until the test moves it on. */
interface TestClock {
  now: () => number;
  advance: (milliseconds: number) => void;
}

function createClock(): TestClock {
  let time = startTime;
  return {
    now: () => time,
    advance(milliseconds) {
      time += milliseconds;
    },
  };
}

/** What `gh --version` prints, for a version of GitHub CLI. */
function ghVersion(version = "2.101.0"): CommandResult {
  return {
    kind: "exited",
    exitCode: 0,
    stdout: `gh version ${version} (2026-09-15)\nhttps://github.com/cli/cli/releases/tag/v${version}\n`,
    stderr: "",
  };
}

/**
 * The machine the core looks for gh on: its platform, environment and home
 * directory, and its executables by path, each with what it answers to
 * `--version`. Any other path holds nothing.
 */
interface TestMachine {
  host: HostEnvironment;
  executables: Map<string, CommandResult>;
}

/** A Linux machine with gh 2.101.0 in `/usr/bin`, which is on PATH. */
function linuxWithGh(): TestMachine {
  return {
    host: {
      platform: "linux",
      env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
      homedir: "/home/octo",
    },
    executables: new Map([["/usr/bin/gh", ghVersion()]]),
  };
}

/** Runs the machine's executables, which only ever answer `--version`. */
function runnerOn(machine: TestMachine): CommandRunner {
  return (command, args) => {
    if (args.join(" ") !== "--version") {
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    }
    return Promise.resolve(
      machine.executables.get(command) ?? { kind: "not-found" },
    );
  };
}

/** Where Verdandi keeps its files in tests: below `home`. */
function verdandiHome(): HostEnvironment {
  return {
    platform: process.platform,
    env: { VERDANDI_HOME: home },
    homedir: join(home, "no-such-home"),
  };
}

/**
 * The core on a fake GitHub and a machine with gh on PATH unless said
 * otherwise, with the real settings file and machine-local state below
 * `home`, and a clock that stands still unless the test moves it on. It
 * waits for nothing, e.g. before trying a request again, unless `timers`
 * says it waits with timers, which a test fakes to move them on together
 * with the clock.
 */
function createTestCore(
  github: FakeGitHub,
  {
    clock = createClock(),
    machine = linuxWithGh(),
    timers = false,
  }: { clock?: TestClock; machine?: TestMachine; timers?: boolean } = {},
): Contract {
  const core = createCore({
    github: () => github,
    runCommand: runnerOn(machine),
    host: machine.host,
    settings: createSettingsFile(verdandiHome()),
    localState: createLocalStateFile(verdandiHome()),
    now: clock.now,
    ...(timers ? {} : { wait: () => Promise.resolve() }),
  });
  cores.push(core);
  return core;
}

/** Moves the clock and the faked timers on together, as time passes. */
async function passTime(clock: TestClock, milliseconds: number) {
  clock.advance(milliseconds);
  await vi.advanceTimersByTimeAsync(milliseconds);
}

/**
 * Opens a scope's list and waits until nothing it shows is being read any
 * more.
 */
async function openUntilLoaded(
  core: Contract,
  scope: Scope,
): Promise<IssueList> {
  return untilSettled(core, scope, () => core.openList(scope));
}

/**
 * The list pushed for a scope once nothing it shows is being read any more,
 * after `act`.
 */
async function untilSettled(
  core: Contract,
  scope: Scope,
  act: () => Promise<void>,
): Promise<IssueList> {
  const settled = new Promise<IssueList>((resolve) => {
    const unsubscribe = core.on("listChanged", (list) => {
      if (
        isDeepStrictEqual(list.scope, scope) &&
        list.loading.status !== "loading" &&
        list.loading.status !== "refreshing"
      ) {
        unsubscribe();
        resolve(list);
      }
    });
  });
  await act();
  return settled;
}

/**
 * Opens an issue page and waits until nothing it shows is being read any
 * more.
 */
async function openPageUntilLoaded(
  core: Contract,
  issueId: string,
): Promise<IssuePage> {
  return pageUntilSettled(core, issueId, () => core.openIssuePage(issueId));
}

/**
 * The issue page pushed once nothing it shows is being read any more, after
 * `act`.
 */
async function pageUntilSettled(
  core: Contract,
  issueId: string,
  act: () => Promise<void>,
): Promise<IssuePage> {
  const settled = new Promise<IssuePage>((resolve) => {
    const unsubscribe = core.on("issuePageChanged", (page) => {
      if (
        page.issueId === issueId &&
        page.loading.status !== "loading" &&
        page.loading.status !== "refreshing"
      ) {
        unsubscribe();
        resolve(page);
      }
    });
  });
  await act();
  return settled;
}

/** The list pushed next for a scope, after `act`. */
async function nextList(
  core: Contract,
  scope: Scope,
  act: () => Promise<void>,
): Promise<IssueList> {
  const pushed = new Promise<IssueList>((resolve) => {
    const unsubscribe = core.on("listChanged", (list) => {
      if (isDeepStrictEqual(list.scope, scope)) {
        unsubscribe();
        resolve(list);
      }
    });
  });
  await act();
  return pushed;
}

/** The sidebar pushed next, after `act`. */
async function nextSidebar(
  core: Contract,
  act: () => Promise<unknown>,
): Promise<SidebarEntries> {
  const pushed = new Promise<SidebarEntries>((resolve) => {
    const unsubscribe = core.on("sidebarChanged", (sidebar) => {
      unsubscribe();
      resolve(sidebar);
    });
  });
  await act();
  return pushed;
}

/** Reads the sidebar and waits until no count is being read any more. */
async function readUntilCounted(core: Contract): Promise<SidebarEntries> {
  const settled = new Promise<SidebarEntries>((resolve) => {
    const unsubscribe = core.on("sidebarChanged", (sidebar) => {
      if (
        sidebar.status === "failed" ||
        sidebar.repositories.every(
          ({ openIssues }) => openIssues.status !== "loading",
        )
      ) {
        unsubscribe();
        resolve(sidebar);
      }
    });
  });
  await core.getSidebar();
  return settled;
}

/**
 * The sidebar's tracked repositories as a user reads them: `owner/name` and
 * the open-issue count, "–" while it is unknown.
 */
function sidebarLines(sidebar: SidebarEntries): string[] {
  if (sidebar.status === "failed") return [sidebar.message];
  return sidebar.repositories.map(({ repository, openIssues }) => {
    const count =
      openIssues.status === "known" ? String(openIssues.count) : "–";
    return `${repository.owner}/${repository.name} ${count}`;
  });
}

/** The issue of a node that has been read, failing the test otherwise. */
function readSummary(node: IssueNode | undefined): IssueSummary {
  if (!node || node.unread) throw new Error("The issue has not been read.");
  return node.issue;
}

/** The issues of a list whose sub-issues are collapsed, by reference. */
function collapsedIssues(list: IssueList): string[] {
  const collapsed: string[] = [];
  function visit(node: IssueNode) {
    if (!node.expanded) collapsed.push(node.issue.reference);
    node.subIssues.forEach(visit);
  }
  list.trees.forEach(visit);
  return collapsed;
}

/**
 * A list as a user reads it: one line per issue, sub-issues indented below
 * their parent issue, with what the row says besides its title. In All, each
 * row starts with its repository chip, as `owner/name`.
 */
function outline(list: IssueList): string[] {
  const lines: string[] = [];
  function add(node: IssueNode, depth: number, tags: string[]) {
    const { repository, reference, title, state, external } = node.issue;
    const chip =
      list.scope.kind === "all"
        ? `${repository.owner}/${repository.name} `
        : "";
    if (state === "closed") tags.unshift("closed");
    if (external) tags.unshift("external");
    lines.push(
      [`${"  ".repeat(depth)}${chip}${reference} ${title}`, ...tags].join(
        " · ",
      ),
    );
    for (const subIssue of node.subIssues) add(subIssue, depth + 1, []);
  }
  for (const tree of list.trees) {
    const parent = tree.parent;
    add(
      tree,
      0,
      parent
        ? [`↑ ${parent.reference}${parent.external ? " external" : ""}`]
        : [],
    );
  }
  return lines;
}

const acmeApi: Scope = {
  kind: "repository",
  repository: { owner: "acme", name: "api" },
};

const acmeWeb: Scope = {
  kind: "repository",
  repository: { owner: "acme", name: "web" },
};

const all: Scope = { kind: "all" };

/** The setup once the core has checked it, which it starts to. */
async function checkedSetup(core: Contract): Promise<Setup> {
  const pushed = nextSetup(core, () => Promise.resolve());
  const current = await core.getSetup();
  return current.status === "checking" ? pushed : current;
}

/** The setup pushed next, after `act`. */
async function nextSetup(
  core: Contract,
  act: () => Promise<unknown>,
): Promise<Setup> {
  const pushed = new Promise<Setup>((resolve) => {
    const unsubscribe = core.on("setupChanged", (setup) => {
      unsubscribe();
      resolve(setup);
    });
  });
  await act();
  return pushed;
}

/** The notices the core pushes from now on. */
function collectNotices(core: Contract): Notice[] {
  const notices: Notice[] = [];
  core.on("notice", (notice) => notices.push(notice));
  return notices;
}

/** The machine-local state file below `home`, parsed, or none. */
async function readLocalState(): Promise<unknown> {
  try {
    return JSON.parse(
      await readFile(join(home, "desktop", "state.json"), "utf8"),
    );
  } catch {
    return undefined;
  }
}

/** The notice that GitHub is read as another account than before. */
function accountChange(previous: string, login: string): Notice {
  return {
    kind: "account-changed",
    previous: { login: previous, host: "github.com" },
    account: { login, host: "github.com" },
  };
}

/** The setup when gh at a path signs in as `login` with stored credentials. */
function readyAs(login: string, path = "/usr/bin/gh"): Setup {
  return {
    status: "ready",
    gh: { path, version: "2.101.0" },
    account: {
      status: "known",
      account: { login, host: "github.com" },
      tokenSource: "stored",
    },
  };
}

describe("setup: finding gh", () => {
  it("finds gh on PATH and names the account it signs in to github.com as", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await checkedSetup(core)).toEqual(readyAs("octo-reader"));
  });

  it.each([
    {
      platform: "darwin",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      homedir: "/Users/octo",
      gh: "/opt/homebrew/bin/gh",
    },
    {
      platform: "linux",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      homedir: "/home/octo",
      gh: "/home/linuxbrew/.linuxbrew/bin/gh",
    },
    {
      platform: "win32",
      PATH: "C:\\Windows\\system32;C:\\Windows",
      homedir: "C:\\Users\\octo",
      gh: "C:\\Program Files\\GitHub CLI\\gh.exe",
    },
  ] as const)(
    "finds gh in a well-known install location on $platform, although a desktop launch leaves it off PATH",
    async ({ platform, PATH, homedir, gh }) => {
      const core = createTestCore(createFakeGitHub({ login: "octo-reader" }), {
        machine: {
          host: {
            platform,
            env: { PATH, ProgramFiles: "C:\\Program Files" },
            homedir,
          },
          executables: new Map([[gh, ghVersion()]]),
        },
      });

      expect(await checkedSetup(core)).toEqual(readyAs("octo-reader", gh));
    },
  );

  it("prefers gh on PATH, in PATH's order, to a well-known install location", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }), {
      machine: {
        host: {
          platform: "darwin",
          env: { PATH: "/Users/octo/bin:/usr/local/bin:/usr/bin" },
          homedir: "/Users/octo",
        },
        executables: new Map([
          ["/opt/homebrew/bin/gh", ghVersion()],
          ["/usr/local/bin/gh", ghVersion()],
          ["/Users/octo/bin/gh", ghVersion()],
        ]),
      },
    });

    expect(await checkedSetup(core)).toMatchObject({
      gh: { path: "/Users/octo/bin/gh" },
    });
  });

  it("never runs gh from a relative PATH entry", async () => {
    const machine = linuxWithGh();
    machine.host.env.PATH = `.:bin:${machine.host.env.PATH ?? ""}`;
    machine.executables.set("gh", ghVersion());
    machine.executables.set(join("bin", "gh"), ghVersion());
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }), {
      machine,
    });

    expect(await checkedSetup(core)).toMatchObject({
      gh: { path: "/usr/bin/gh" },
    });
  });

  it("passes over an unusable gh for a usable one found later", async () => {
    const machine = linuxWithGh();
    machine.executables.set("/usr/local/bin/gh", ghVersion("2.40.0"));
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }), {
      machine,
    });

    expect(await checkedSetup(core)).toEqual(readyAs("octo-reader"));
  });

  it("blocks the app when no usable gh is found, saying why each one found is unusable", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }), {
      machine: {
        host: {
          platform: "linux",
          env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
          homedir: "/home/octo",
        },
        executables: new Map<string, CommandResult>([
          ["/usr/local/bin/gh", ghVersion("2.40.0")],
          [
            "/usr/bin/gh",
            {
              kind: "exited",
              exitCode: 0,
              stdout: "gh 0.4.2 - the Git Helper\n",
              stderr: "",
            },
          ],
          [
            "/home/octo/.local/bin/gh",
            { kind: "failed-to-start", message: "spawn EACCES" },
          ],
        ]),
      },
    });

    expect(await checkedSetup(core)).toEqual({
      status: "blocked",
      problem: {
        kind: "no-usable-gh",
        notUsable: [
          {
            path: "/usr/local/bin/gh",
            reason: "It is GitHub CLI 2.40.0; Verdandi needs 2.81.0 or later.",
          },
          {
            path: "/usr/bin/gh",
            reason: "It is not GitHub CLI: it did not report a gh version.",
          },
          {
            path: "/home/octo/.local/bin/gh",
            reason: "It cannot be run: spawn EACCES",
          },
        ],
      },
    });
  });

  it("asks GitHub nothing while blocked", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const machine = linuxWithGh();
    machine.executables.clear();
    const core = createTestCore(github, { machine });

    await core.getSidebar();
    await core.openList(acmeApi);
    await checkedSetup(core);

    expect(github.requestsReceived).toBe(0);
    expect(github.authStatusChecks).toBe(0);
  });
});

describe("setup: credentials", () => {
  it("asks gh about its credentials once at startup", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);

    await readUntilCounted(core);
    await openUntilLoaded(core, acmeApi);

    expect(github.authStatusChecks).toBe(1);
  });

  it("blocks the app while gh is not signed in to github.com", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.signOut();
    const core = createTestCore(github);

    expect(await checkedSetup(core)).toEqual({
      status: "blocked",
      problem: {
        kind: "signed-out",
        gh: { path: "/usr/bin/gh", version: "2.101.0" },
      },
    });
  });

  it("blocks the app while GitHub rejects gh's credentials", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.rejectCredentials();
    const core = createTestCore(github);

    expect(await checkedSetup(core)).toEqual({
      status: "blocked",
      problem: {
        kind: "credentials-rejected",
        gh: { path: "/usr/bin/gh", version: "2.101.0" },
        login: "octo-reader",
        tokenSource: "stored",
      },
    });
  });

  it("names the environment variable whose rejected token overrides gh's stored credentials", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.signInAs("octo-bot", "GH_TOKEN");
    github.rejectCredentials();
    const core = createTestCore(github);

    expect(await checkedSetup(core)).toMatchObject({
      status: "blocked",
      problem: {
        kind: "credentials-rejected",
        login: undefined,
        tokenSource: "GH_TOKEN",
      },
    });
  });

  it("blocks the app when gh answers the check by asking to log in", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.failAuthStatusWith({
      kind: "gh-signed-out",
      message: "To get started with GitHub CLI, please run:  gh auth login",
    });
    const core = createTestCore(github);

    expect(await checkedSetup(core)).toMatchObject({
      status: "blocked",
      problem: { kind: "signed-out" },
    });
  });

  it.each(["GH_TOKEN", "GITHUB_TOKEN"] as const)(
    "names %s when its token overrides gh's stored credentials",
    async (variable) => {
      const github = createFakeGitHub({ login: "octo-reader" });
      github.signInAs("octo-bot", variable);
      const core = createTestCore(github);

      expect(await checkedSetup(core)).toMatchObject({
        status: "ready",
        account: {
          status: "known",
          account: { login: "octo-bot", host: "github.com" },
          tokenSource: variable,
        },
      });
    },
  );

  it("does not block when gh cannot confirm its credentials, e.g. without a connection", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    const offline = {
      kind: "gh-failed",
      message:
        'Get "https://api.github.com/": dial tcp: lookup api.github.com: no such host',
    } as const;
    github.failAuthStatusWith(offline);
    github.failWith(offline);
    const core = createTestCore(github);

    expect(await checkedSetup(core)).toEqual({
      status: "ready",
      gh: { path: "/usr/bin/gh", version: "2.101.0" },
      account: {
        status: "unconfirmed",
        message: `GitHub CLI (gh) failed: ${offline.message}`,
      },
    });
    // What fails fails locally.
    expect(sidebarLines(await readUntilCounted(core))).toEqual(["acme/api –"]);
  });

  it("tells the user when gh signs in as another account", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github);
    const notices = collectNotices(core);
    await checkedSetup(core);

    github.signInAs("octo-writer");
    await core.checkSetupAgain();

    expect(notices).toEqual([accountChange("octo-reader", "octo-writer")]);
  });
});

describe("setup: during a session", () => {
  /** A core that has loaded acme/api's list, the screen shown. */
  async function loadedSession() {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const machine = linuxWithGh();
    const core = createTestCore(github, { machine });
    await readUntilCounted(core);
    await openUntilLoaded(core, acmeApi);
    return { core, github, machine };
  }

  it("blocks the app once gh auth status confirms that GitHub rejected gh's credentials with a 401", async () => {
    const { core, github } = await loadedSession();

    github.rejectCredentials();
    const blocked = await nextSetup(core, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );

    expect(blocked).toMatchObject({
      status: "blocked",
      problem: { kind: "credentials-rejected" },
    });
    expect(github.authStatusChecks).toBe(2);
  });

  it("blocks the app once gh auth status confirms that gh was signed out", async () => {
    const { core, github } = await loadedSession();

    github.signOut();
    const blocked = await nextSetup(core, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );

    expect(blocked).toMatchObject({
      status: "blocked",
      problem: { kind: "signed-out" },
    });
  });

  it("stays usable when gh auth status accepts the credentials after a 401", async () => {
    const { core, github } = await loadedSession();

    const setups: Setup[] = [];
    core.on("setupChanged", (setup) => setups.push(setup));

    github.failWith({ kind: "http", status: 401, message: "Bad credentials" });
    await untilSettled(core, acmeApi, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );
    await vi.waitFor(() => {
      expect(github.authStatusChecks).toBeGreaterThan(1);
    });

    expect(await core.getSetup()).toEqual(readyAs("octo-reader"));
    expect(setups).toEqual([]);
  });

  it("blocks the app once gh is found missing", async () => {
    const { core, github, machine } = await loadedSession();

    machine.executables.clear();
    github.failWith({ kind: "gh-not-found" });
    const blocked = await nextSetup(core, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );

    expect(blocked).toEqual({
      status: "blocked",
      problem: { kind: "no-usable-gh", notUsable: [] },
    });
  });

  it.each<[string, GitHubError, "stale" | "failed"]>([
    [
      "HTTP 403 for SSO",
      {
        kind: "unavailable",
        message:
          "Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.",
        access: {
          kind: "sso",
          message:
            "Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.",
          url: undefined,
        },
      },
      "failed",
    ],
    [
      "HTTP 404",
      { kind: "unavailable", message: "Not Found", access: undefined },
      "failed",
    ],
    [
      "HTTP 410",
      {
        kind: "unavailable",
        message: "Issues are disabled for this repo",
        access: undefined,
      },
      "failed",
    ],
    [
      "a network failure",
      {
        kind: "gh-failed",
        message:
          'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host',
      },
      "stale",
    ],
    ["HTTP 502", { kind: "server-error", message: "Server Error" }, "stale"],
    [
      "a GraphQL timeout",
      {
        kind: "server-error",
        message:
          "Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug.",
      },
      "stale",
    ],
  ])("never blocks the app for %s", async (_, error, status) => {
    const { core, github } = await loadedSession();
    const setups: Setup[] = [];
    core.on("setupChanged", (setup) => setups.push(setup));

    github.failWith(error);
    const list = await untilSettled(core, acmeApi, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );

    expect(list.loading.status).toBe(status);
    expect(setups).toEqual([]);
    expect(github.authStatusChecks).toBe(1);
  });

  it("holds GitHub requests while blocked, and returns to the screen shown once Check again succeeds, reading what failed again at once with what it has meanwhile", async () => {
    const { core, github } = await loadedSession();
    github.rejectCredentials();
    await nextSetup(core, () => core.refresh({ kind: "list", scope: acmeApi }));
    const lists: IssueList[] = [];
    core.on("listChanged", (list) => lists.push(list));

    // Nothing is asked of GitHub while the blocker is up.
    const received = github.requestsReceived;
    await core.revalidate({ kind: "list", scope: acmeApi });
    expect(github.requestsReceived).toBe(received);

    github.signInAs("octo-reader");
    const reread = untilSettled(core, acmeApi, () => Promise.resolve());
    expect(await core.checkSetupAgain()).toEqual(readyAs("octo-reader"));

    expect((await reread).loading.status).toBe("current");
    expect(github.requestsReceived).toBeGreaterThan(received);
    // The list kept its issues while it was read again.
    expect(lists.map((list) => outline(list))).not.toContainEqual([]);
  });

  it("reads what waited while blocked once, not again as the blocker clears", async () => {
    const { core, github } = await loadedSession();
    github.rejectCredentials();
    await nextSetup(core, () => core.refresh({ kind: "list", scope: acmeApi }));
    // Opened again while blocked, the list's page waits.
    await core.openList(acmeApi);
    const asked = github.requestsFor("acme/api");

    github.signInAs("octo-reader");
    const reread = untilSettled(core, acmeApi, () => Promise.resolve());
    await core.checkSetupAgain();

    expect((await reread).loading.status).toBe("current");
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(0);
    });
    expect(github.requestsFor("acme/api")).toBe(asked + 1);
  });

  it("reads the issue page shown again once the blocker clears, as it failed", async () => {
    const { core, github } = await loadedSession();
    const page = await openPageUntilLoaded(core, "I_acme/api#1");
    github.rejectCredentials();
    await nextSetup(core, () =>
      core.refresh({ kind: "issue", issueId: page.issueId }),
    );

    github.signInAs("octo-reader");
    const reread = pageUntilSettled(core, page.issueId, async () => {
      await core.checkSetupAgain();
    });

    expect((await reread).loading.status).toBe("current");
  });

  it("stays blocked when Check again finds the same problem", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.signOut();
    const core = createTestCore(github);
    await checkedSetup(core);

    expect(await core.checkSetupAgain()).toMatchObject({
      status: "blocked",
      problem: { kind: "signed-out" },
    });
  });

  it("finds gh installed since with Check again", async () => {
    const machine = linuxWithGh();
    machine.executables.clear();
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }), {
      machine,
    });
    await checkedSetup(core);

    machine.executables.set("/usr/bin/gh", ghVersion());

    expect(await core.checkSetupAgain()).toEqual(readyAs("octo-reader"));
  });
});

describe("account changes", () => {
  it("never shows what a slow answer for the previous account brings once GitHub answers as another", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Private roadmap" }]);
    const core = createTestCore(github);
    await checkedSetup(core);
    const lists: IssueList[] = [];
    core.on("listChanged", (list) => lists.push(list));
    // octo-reader's answer with acme/api's issues is slow.
    github.pause("fetchOpenIssues");
    void core.openList(acmeApi);
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });

    // gh switches to an account that may not read acme/api, and the
    // sidebar's counts are the first answer as that account.
    github.signInAs("octo-writer");
    github.hide("acme/api");
    await readUntilCounted(core);
    const list = await untilSettled(core, acmeApi, () => {
      github.resume();
      return Promise.resolve();
    });

    expect(list.loading).toEqual({
      status: "failed",
      problem: { kind: "unavailable", access: undefined },
    });
    expect(lists.flatMap((pushed) => outline(pushed))).toEqual([]);
  });

  it("follows GitHub answering as another account once, naming it, however late answers as the previous one arrive", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);
    await checkedSetup(core);
    const notices = collectNotices(core);
    github.pause("fetchOpenIssues");
    void core.openList(acmeApi);
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });

    github.signInAs("octo-writer");
    const setup = await nextSetup(core, () => readUntilCounted(core));
    const list = await untilSettled(core, acmeApi, () => {
      github.resume();
      return Promise.resolve();
    });

    expect(setup).toEqual(readyAs("octo-writer"));
    expect(outline(list)).toEqual(["#1 Crash on start"]);
    expect(notices).toEqual([accountChange("octo-reader", "octo-writer")]);
    expect(await core.getSetup()).toEqual(readyAs("octo-writer"));
  });

  it("asks gh which account it reads GitHub as when the window regains focus, and follows it", async () => {
    const clock = createClock();
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github, { clock });
    await checkedSetup(core);
    const notices = collectNotices(core);

    clock.advance(minute);
    github.signInAs("octo-writer");
    const setup = await nextSetup(core, () => core.revalidate(undefined));

    expect(setup).toEqual(readyAs("octo-writer"));
    expect(notices).toEqual([accountChange("octo-reader", "octo-writer")]);
  });

  it("asks gh as the window regains focus at most once a minute", async () => {
    const clock = createClock();
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github, { clock });
    await checkedSetup(core);

    // Within a minute of the check at startup.
    clock.advance(minute - 1);
    await core.revalidate(undefined);
    await core.revalidate(undefined);
    expect(github.authStatusChecks).toBe(1);

    clock.advance(1);
    await core.revalidate(undefined);
    await core.revalidate(undefined);
    await vi.waitFor(() => {
      expect(github.authStatusChecks).toBe(2);
    });
    clock.advance(minute - 1);
    await core.revalidate(undefined);
    await new Promise((resolve) => setImmediate(resolve));
    expect(github.authStatusChecks).toBe(2);
  });
  it("follows gh to another account it names once GitHub answered 401", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);
    await readUntilCounted(core);
    const notices = collectNotices(core);

    github.signInAs("octo-writer");
    github.failNextWith({
      kind: "http",
      status: 401,
      message: "Bad credentials",
    });
    await core.refresh(undefined);

    await vi.waitFor(() => {
      expect(notices).toEqual([accountChange("octo-reader", "octo-writer")]);
    });
    expect(github.authStatusChecks).toBe(2);
  });

  it("asks gh again, rather than switching back, when GitHub answered as another account while gh was asked", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await checkedSetup(core);
    const notices = collectNotices(core);
    // gh names octo-reader, but its answer is slow.
    github.pause("fetchAuthStatus");
    clock.advance(minute);
    await core.revalidate(undefined);
    await vi.waitFor(() => {
      expect(github.authStatusChecks).toBe(2);
    });

    github.signInAs("octo-writer");
    await readUntilCounted(core);
    github.resume();

    expect(await core.checkSetupAgain()).toEqual(readyAs("octo-writer"));
    expect(notices).toEqual([accountChange("octo-reader", "octo-writer")]);
  });

  it("reads the issue page shown again as the new account, never showing what the previous one read", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Private roadmap" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openPageUntilLoaded(core, "I_acme/api#1");
    const pages: IssuePage[] = [];
    core.on("issuePageChanged", (page) => pages.push(page));

    github.signInAs("octo-writer");
    github.hide("acme/api");
    clock.advance(minute);
    const page = await pageUntilSettled(core, "I_acme/api#1", () =>
      core.revalidate({ kind: "issue", issueId: "I_acme/api#1" }),
    );

    expect(page.loading).toEqual({
      status: "failed",
      problem: { kind: "unavailable", access: undefined },
    });
    expect(pages.map(({ issue }) => issue)).toEqual(pages.map(() => undefined));
  });

  it("drops what was read as the previous account when the setup blocker clears as another", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Private roadmap" }]);
    const core = createTestCore(github);
    await readUntilCounted(core);
    await openUntilLoaded(core, acmeApi);
    github.rejectCredentials();
    await nextSetup(core, () => core.refresh({ kind: "list", scope: acmeApi }));
    const notices = collectNotices(core);

    github.signInAs("octo-writer");
    github.hide("acme/api");
    const list = await untilSettled(core, acmeApi, async () => {
      await core.checkSetupAgain();
    });

    expect(list.loading).toEqual({
      status: "failed",
      problem: { kind: "unavailable", access: undefined },
    });
    expect(outline(list)).toEqual([]);
    expect(notices).toEqual([accountChange("octo-reader", "octo-writer")]);
  });

  it("keeps the tracked repositories, dropping the previous account's counts at once for the new one's", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Crash on start" },
      { number: 2, title: "Usage endpoint" },
    ]);
    github.addRepository("acme/web", [{ number: 1, title: "Landing page" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    expect(sidebarLines(await readUntilCounted(core))).toEqual([
      "acme/api 2",
      "acme/web 1",
    ]);
    const pushed: SidebarEntries[] = [];
    core.on("sidebarChanged", (sidebar) => pushed.push(sidebar));

    github.signInAs("octo-writer");
    github.hide("acme/web");
    clock.advance(minute);
    await core.revalidate(undefined);
    await vi.waitFor(() => {
      expect(pushed).toHaveLength(2);
    });

    expect(pushed.map((sidebar) => sidebarLines(sidebar))).toEqual([
      ["acme/api –", "acme/web –"],
      ["acme/api 2", "acme/web –"],
    ]);
  });

  it("sends none of the requests still waiting for the previous account, and reads what is on screen again as the new one", async () => {
    const names = Array.from({ length: 6 }, (_, n) => `acme/repo-${String(n)}`);
    await writeSettings({
      version: 1,
      repositories: names.map((name) => ({ name })),
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    for (const name of names) {
      github.addRepository(name, [{ number: 1, title: `Issue of ${name}` }]);
    }
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await checkedSetup(core);
    github.pause();
    void core.openList(all);
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(4);
    });

    clock.advance(minute);
    github.signInAs("octo-writer");
    const list = await untilSettled(core, all, async () => {
      await nextSetup(core, () =>
        core.revalidate({ kind: "list", scope: all }),
      );
      github.resume();
    });

    expect(list.trees).toHaveLength(6);
    expect(list.loading.status).toBe("current");
    expect(
      github.received.filter((read) => read.startsWith("fetchOpenIssues")),
    ).toEqual([
      ...names.slice(0, 4).map((name) => `fetchOpenIssues ${name}`),
      ...names.map((name) => `fetchOpenIssues ${name}`),
    ]);
  });
});

describe("setup: choosing gh", () => {
  /** A machine without gh anywhere Verdandi looks, but with one elsewhere. */
  function machineWithHiddenGh(): TestMachine {
    return {
      host: {
        platform: "linux",
        env: { PATH: "/usr/bin:/bin" },
        homedir: "/home/octo",
      },
      executables: new Map([["/opt/tools/gh", ghVersion()]]),
    };
  }

  it("uses a chosen gh and remembers it on this machine, below VERDANDI_HOME", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }), {
      machine: machineWithHiddenGh(),
    });
    await checkedSetup(core);

    expect(await core.chooseGhExecutable("/opt/tools/gh")).toEqual({
      status: "chosen",
      setup: readyAs("octo-reader", "/opt/tools/gh"),
    });
    expect(await readLocalState()).toEqual({ ghExecutable: "/opt/tools/gh" });
  });

  it("looks for the chosen gh first after a restart, while it is usable", async () => {
    const machine = machineWithHiddenGh();
    machine.executables.set("/usr/bin/gh", ghVersion());
    const github = createFakeGitHub({ login: "octo-reader" });
    await createTestCore(github, { machine }).chooseGhExecutable(
      "/opt/tools/gh",
    );

    const restarted = createTestCore(github, { machine });

    expect(await checkedSetup(restarted)).toMatchObject({
      gh: { path: "/opt/tools/gh" },
    });
  });

  it.each([
    [
      "is no gh",
      "/home/octo/notes.txt",
      { kind: "failed-to-start", message: "spawn EACCES" },
      "It cannot be run: spawn EACCES",
    ],
    [
      "is another program",
      "/usr/bin/git",
      {
        kind: "exited",
        exitCode: 0,
        stdout: "git version 2.51.0\n",
        stderr: "",
      },
      "It is not GitHub CLI: it did not report a gh version.",
    ],
    [
      "is too old",
      "/opt/old/gh",
      ghVersion("2.80.1"),
      "It is GitHub CLI 2.80.1; Verdandi needs 2.81.0 or later.",
    ],
    [
      "no longer exists",
      "/opt/gone/gh",
      { kind: "not-found" },
      "There is no file there.",
    ],
    [
      "never finishes",
      "/opt/hangs/gh",
      { kind: "timed-out" },
      "It did not answer `--version` within 10 seconds.",
    ],
  ] as const)(
    "explains a chosen file that %s, remembering nothing",
    async (_, path, answer, reason) => {
      const machine = machineWithHiddenGh();
      machine.executables.set(path, answer);
      const core = createTestCore(createFakeGitHub({ login: "octo-reader" }), {
        machine,
      });
      await checkedSetup(core);

      expect(await core.chooseGhExecutable(path)).toEqual({
        status: "invalid",
        path,
        reason,
      });
      expect(await readLocalState()).toBeUndefined();
      expect(await core.getSetup()).toMatchObject({ status: "blocked" });
    },
  );

  it("explains that it cannot run a .cmd file on Windows", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }), {
      machine: {
        host: {
          platform: "win32",
          env: { PATH: "C:\\Windows" },
          homedir: "C:\\Users\\octo",
        },
        executables: new Map([["C:\\tools\\gh.cmd", ghVersion()]]),
      },
    });

    expect(await core.chooseGhExecutable("C:\\tools\\gh.cmd")).toEqual({
      status: "invalid",
      path: "C:\\tools\\gh.cmd",
      reason: "Verdandi cannot run .cmd or .bat files. Choose gh.exe.",
    });
  });

  it("stays blocked with a chosen gh that is not signed in", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.signOut();
    const core = createTestCore(github, { machine: machineWithHiddenGh() });

    expect(await core.chooseGhExecutable("/opt/tools/gh")).toMatchObject({
      status: "chosen",
      setup: { status: "blocked", problem: { kind: "signed-out" } },
    });
  });

  it("forgets a chosen gh that is gone once another is found, and says so", async () => {
    await mkdir(join(home, "desktop"), { recursive: true });
    await writeFile(
      join(home, "desktop", "state.json"),
      JSON.stringify({ ghExecutable: "/opt/tools/gh" }),
    );
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));
    const notices = collectNotices(core);

    expect(await checkedSetup(core)).toEqual(readyAs("octo-reader"));
    expect(notices).toEqual([
      {
        kind: "gh-replaced",
        previous: "/opt/tools/gh",
        gh: { path: "/usr/bin/gh", version: "2.101.0" },
      },
    ]);
    expect(await readLocalState()).toEqual({});
  });

  it("keeps a chosen gh that is gone while no other is found", async () => {
    await mkdir(join(home, "desktop"), { recursive: true });
    await writeFile(
      join(home, "desktop", "state.json"),
      JSON.stringify({ ghExecutable: "/opt/tools/gh" }),
    );
    const machine = linuxWithGh();
    machine.executables.clear();
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }), {
      machine,
    });

    expect(await checkedSetup(core)).toEqual({
      status: "blocked",
      problem: {
        kind: "no-usable-gh",
        notUsable: [
          { path: "/opt/tools/gh", reason: "There is no file there." },
        ],
      },
    });
    expect(await readLocalState()).toEqual({ ghExecutable: "/opt/tools/gh" });
  });

  it("discards machine-local state it cannot read, silently", async () => {
    await mkdir(join(home, "desktop"), { recursive: true });
    await writeFile(join(home, "desktop", "state.json"), "{ not json");
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }), {
      machine: machineWithHiddenGh(),
    });
    const notices = collectNotices(core);
    await checkedSetup(core);

    await core.chooseGhExecutable("/opt/tools/gh");

    expect(notices).toEqual([]);
    expect(await readLocalState()).toEqual({ ghExecutable: "/opt/tools/gh" });
  });
});

describe("GitHub requests", () => {
  it("are sent at most four at a time", async () => {
    const names = Array.from(
      { length: 10 },
      (_, n) => `acme/repo-${String(n)}`,
    );
    await writeSettings({
      version: 1,
      repositories: names.map((name) => ({ name })),
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    for (const name of names) github.addRepository(name, []);
    const core = createTestCore(github);
    await checkedSetup(core);
    github.pause();

    const loaded = openUntilLoaded(core, all);
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(4);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(github.requestsInFlight).toBe(4);

    github.resume();
    expect((await loaded).loading.status).toBe("current");
  });

  it("go to the screen shown before the sidebar's counts, whichever was asked for first", async () => {
    const names = ["acme/api", "acme/web", "acme/cli", "acme/docs"];
    await writeSettings({
      version: 1,
      repositories: names.map((name) => ({ name })),
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    for (const name of names) {
      github.addRepository(name, [{ number: 1, title: `Issue of ${name}` }]);
    }
    const core = createTestCore(github);
    await checkedSetup(core);
    github.pause("fetchOpenIssues");
    void core.openList(all);
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(4);
    });

    // The sidebar asks for its counts before All is refreshed; both wait
    // for the pages under way.
    await core.getSidebar();
    await core.refresh({ kind: "list", scope: all });
    await new Promise((resolve) => setImmediate(resolve));
    github.resume();
    await vi.waitFor(() => {
      expect(github.received).toHaveLength(9);
    });

    expect(github.received.slice(4)).toEqual([
      ...names.map((name) => `fetchOpenIssues ${name}`),
      `fetchRepositorySummaries ${names.join(" ")}`,
    ]);
  });
});

describe("leaving a screen", () => {
  /** Tracks `count` repositories, `acme/repo-0` and on, with an issue each. */
  async function trackRepositories(github: FakeGitHub, count: number) {
    const names = Array.from(
      { length: count },
      (_, n) => `acme/repo-${String(n)}`,
    );
    await writeSettings({
      version: 1,
      repositories: names.map((name) => ({ name })),
    });
    for (const name of names) {
      github.addRepository(name, [{ number: 1, title: `Issue of ${name}` }]);
    }
  }

  it("drops the requests it has not sent, lets those under way finish, and loads the rest once it shows again", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    await trackRepositories(github, 6);
    const core = createTestCore(github);
    await checkedSetup(core);
    let left: IssueList | undefined;
    core.on("listChanged", (list) => {
      if (list.scope.kind === "all") left = list;
    });
    github.pause();
    void core.openList(all);
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(4);
    });

    const page = pageUntilSettled(core, "I_acme/repo-0#1", () =>
      core.openIssuePage("I_acme/repo-0#1"),
    );
    github.resume();
    await page;

    expect(github.requestsFor("acme/repo-4")).toBe(0);
    expect(github.requestsFor("acme/repo-5")).toBe(0);
    // Until it shows again, All is incomplete, never empty.
    await vi.waitFor(() => {
      expect(
        left?.repositories.map(
          ({ repository, loading }) =>
            `${repository.name} ${loading.status === "failed" ? loading.problem.kind : loading.status}`,
        ),
      ).toEqual([
        "repo-0 current",
        "repo-1 current",
        "repo-2 current",
        "repo-3 current",
        "repo-4 interrupted",
        "repo-5 interrupted",
      ]);
    });

    const shownAgain = await untilSettled(core, all, () => core.openList(all));

    expect(shownAgain.trees).toHaveLength(6);
    expect(shownAgain.loading.status).toBe("current");
    for (let n = 0; n < 6; n++) {
      expect(github.requestsFor(`acme/repo-${String(n)}`)).toBe(1);
    }
  });

  it("reads what an issue page lacks once it shows again, after it was left while loading", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/web" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Launch billing", subIssues: ["other/lib#2"] },
    ]);
    github.addRepository("other/lib", [{ number: 2, title: "Shared client" }]);
    github.addRepository("acme/web", [{ number: 1, title: "Landing page" }]);
    const core = createTestCore(github);
    await checkedSetup(core);
    let left: IssuePage | undefined;
    core.on("issuePageChanged", (page) => {
      left = page;
    });
    github.pause("fetchIssueDetails");
    void core.openIssuePage("I_acme/api#1");
    await vi.waitFor(() => {
      expect(github.received).toContain("fetchIssueDetails acme/api#1");
    });

    const list = untilSettled(core, acmeWeb, () => core.openList(acmeWeb));
    github.resume();
    await list;

    // The issue under way arrived; its sub-issue was never asked for.
    expect(github.received).not.toContain("fetchIssues other/lib#2");
    await vi.waitFor(() => {
      expect(left?.loading.status).toBe("current");
    });
    expect(left?.issue?.title).toBe("Launch billing");
    expect(left?.subIssues[0]?.unread).toEqual({
      status: "failed",
      problem: { kind: "interrupted" },
    });

    const shownAgain = await openPageUntilLoaded(core, "I_acme/api#1");

    expect(shownAgain.subIssues.map(({ issue }) => issue.title)).toEqual([
      "Shared client",
    ]);
    expect(shownAgain.subIssues[0]?.unread).toBeUndefined();
  });
});

describe("rate limits", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A fake GitHub on the test's clock with `acme/api`, a core that waits
   * with the faked timers, and the rate-limit states it pushes.
   */
  function rateLimitedSession() {
    const clock = createClock();
    const github = createFakeGitHub({ login: "octo-reader", now: clock.now });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github, { clock, timers: true });
    const limits: RateLimitState[][] = [];
    core.on("rateLimitsChanged", (states) => limits.push(states));
    return { clock, github, core, limits };
  }

  it("pauses the pool whose budget is used up until it resets, then loads the screen on its own", async () => {
    const { clock, github, core, limits } = rateLimitedSession();
    github.setBudget("graphql", {
      remaining: 0,
      resetAt: startTime + 20 * minute,
    });
    const pushed: IssueList[] = [];
    core.on("listChanged", (list) => pushed.push(list));

    await core.openList(acmeApi);
    const paused: RateLimitState[] = [
      { pool: "graphql", status: "paused", until: startTime + 20 * minute },
    ];
    await vi.waitFor(() => {
      expect(limits.at(-1)).toEqual(paused);
    });
    expect(await core.getRateLimits()).toEqual(paused);
    // Loading, never empty or failed, while it waits.
    expect(pushed.at(-1)?.loading).toEqual({ status: "loading" });

    await passTime(clock, 19 * minute);
    expect(github.requestsFor("acme/api")).toBe(1);

    const loaded = await untilSettled(core, acmeApi, () =>
      passTime(clock, minute),
    );

    expect(outline(loaded)).toEqual(["#1 Crash on start"]);
    expect(loaded.loading.status).toBe("current");
    expect(limits.at(-1)).toEqual([]);
    expect(await core.getRateLimits()).toEqual([]);
    expect(await core.getSetup()).toEqual(readyAs("octo-reader"));
    expect(github.authStatusChecks).toBe(1);
  });

  it("keeps what was read browsable while the pool is paused, and reads it again once it resets", async () => {
    const { clock, github, core, limits } = rateLimitedSession();
    await openUntilLoaded(core, acmeApi);
    github.setBudget("graphql", {
      remaining: 0,
      resetAt: startTime + 30 * minute,
    });
    github.addRepository("acme/api", [
      { number: 1, title: "Crash on start, again" },
    ]);

    const refreshing = await nextList(core, acmeApi, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );
    await vi.waitFor(() => {
      expect(limits.at(-1)).toEqual([
        { pool: "graphql", status: "paused", until: startTime + 30 * minute },
      ]);
    });

    expect(outline(refreshing)).toEqual(["#1 Crash on start"]);
    expect(refreshing.loading.status).toBe("refreshing");

    const refreshed = await untilSettled(core, acmeApi, () =>
      passTime(clock, 30 * minute),
    );

    expect(outline(refreshed)).toEqual(["#1 Crash on start, again"]);
    expect(refreshed.loading.status).toBe("current");
  });

  it("goes on only with the screen shown once the pool resets, and marks a screen left meanwhile incomplete", async () => {
    const { clock, github, core, limits } = rateLimitedSession();
    github.addRepository("acme/web", [{ number: 1, title: "Landing page" }]);
    github.setBudget("graphql", {
      remaining: 0,
      resetAt: startTime + 20 * minute,
    });
    let left: IssueList | undefined;
    core.on("listChanged", (list) => {
      if (isDeepStrictEqual(list.scope, acmeApi)) left = list;
    });
    await core.openList(acmeApi);
    await vi.waitFor(() => {
      expect(limits.at(-1)).toHaveLength(1);
    });

    await core.openList(acmeWeb);
    const web = await untilSettled(core, acmeWeb, () =>
      passTime(clock, 20 * minute),
    );

    expect(outline(web)).toEqual(["#1 Landing page"]);
    expect(github.requestsFor("acme/api")).toBe(1);
    expect(left?.loading).toEqual({
      status: "failed",
      problem: { kind: "interrupted" },
    });

    const api = await openUntilLoaded(core, acmeApi);

    expect(outline(api)).toEqual(["#1 Crash on start"]);
  });

  /** GitHub's secondary rate limit, asking to wait that long, if at all. */
  function secondaryLimit(retryAfter?: number): GitHubError {
    return {
      kind: "rate-limited",
      limit: "secondary",
      message:
        "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
      retryAfter,
    };
  }

  it("no longer holds requests back for the previous account's rate limit once GitHub is read as another", async () => {
    const { clock, github, core, limits } = rateLimitedSession();
    github.setBudget("graphql", {
      remaining: 0,
      resetAt: startTime + 20 * minute,
    });
    await core.openList(acmeApi);
    await vi.waitFor(() => {
      expect(limits.at(-1)).toEqual([
        { pool: "graphql", status: "paused", until: startTime + 20 * minute },
      ]);
    });

    // The other account draws on a budget of its own.
    github.signInAs("octo-writer");
    github.setBudget("graphql", { remaining: 5000 });
    await passTime(clock, minute);
    const loaded = await untilSettled(core, acmeApi, () =>
      core.revalidate({ kind: "list", scope: acmeApi }),
    );

    expect(outline(loaded)).toEqual(["#1 Crash on start"]);
    expect(limits.at(-1)).toEqual([]);
    expect(await core.getRateLimits()).toEqual([]);
  });

  it("takes no rate limit from a late answer as the previous account, which names no account", async () => {
    const { clock, github, core, limits } = rateLimitedSession();
    await checkedSetup(core);
    github.setBudget("graphql", {
      remaining: 0,
      resetAt: startTime + 20 * minute,
    });
    // octo-reader's answer, a rate limit, is slow.
    github.pause("fetchOpenIssues");
    void core.openList(acmeApi);
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });

    github.signInAs("octo-writer");
    github.setBudget("graphql", { remaining: 5000 });
    await passTime(clock, minute);
    await nextSetup(core, () =>
      core.revalidate({ kind: "list", scope: acmeApi }),
    );
    const loaded = await untilSettled(core, acmeApi, () => {
      github.resume();
      return Promise.resolve();
    });

    expect(outline(loaded)).toEqual(["#1 Crash on start"]);
    expect(limits).toEqual([]);
    expect(await core.getRateLimits()).toEqual([]);
  });

  it("waits as long as GitHub asks after a secondary rate limit", async () => {
    const { clock, github, core, limits } = rateLimitedSession();
    github.failNextWith(secondaryLimit(90 * 1000));

    await core.openList(acmeApi);
    await vi.waitFor(() => {
      expect(limits.at(-1)).toEqual([
        { pool: "graphql", status: "paused", until: startTime + 90 * 1000 },
      ]);
    });
    await passTime(clock, 89 * 1000);
    expect(github.requestsFor("acme/api")).toBe(1);

    const loaded = await untilSettled(core, acmeApi, () =>
      passTime(clock, 1000),
    );

    expect(outline(loaded)).toEqual(["#1 Crash on start"]);
    expect(github.requestsFor("acme/api")).toBe(2);
  });

  it("waits a minute after a secondary rate limit that does not say how long, then twice as long after each further one, up to 15 minutes", async () => {
    const { clock, github, core } = rateLimitedSession();
    github.failNextWith(secondaryLimit(), 6);
    /** How long each pause lasts, in minutes. */
    const pauses: number[] = [];
    core.on("rateLimitsChanged", (states) => {
      const paused = states.find(({ status }) => status === "paused");
      if (paused) pauses.push((paused.until - clock.now()) / minute);
    });

    const loaded = untilSettled(core, acmeApi, () => core.openList(acmeApi));
    for (const [count, pause] of [1, 2, 4, 8, 15, 15].entries()) {
      await vi.waitFor(() => {
        expect(pauses).toHaveLength(count + 1);
      });
      await passTime(clock, pause * minute);
    }

    expect(outline(await loaded)).toEqual(["#1 Crash on start"]);
    expect(pauses).toEqual([1, 2, 4, 8, 15, 15]);
  });

  it("keeps going one at a time, and waits twice as long the next time, whatever becomes of requests sent before a secondary rate limit", async () => {
    const { clock, github, core } = rateLimitedSession();
    const names = Array.from({ length: 6 }, (_, n) => `acme/repo-${String(n)}`);
    await writeSettings({
      version: 1,
      repositories: names.map((name) => ({ name })),
    });
    for (const name of names) {
      github.addRepository(name, [{ number: 1, title: `Issue of ${name}` }]);
    }
    const pauses: number[] = [];
    core.on("rateLimitsChanged", (states) => {
      const paused = states.find(({ status }) => status === "paused");
      if (paused) pauses.push((paused.until - clock.now()) / minute);
    });
    // The first of the four requests sent at once meets the limit; the
    // three sent with it succeed after it.
    github.failNextWith(secondaryLimit());
    const loaded = untilSettled(core, all, () => core.openList(all));
    await vi.waitFor(() => {
      expect(pauses).toEqual([1]);
    });
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(0);
    });

    github.failNextWith(secondaryLimit());
    github.pause();
    await passTime(clock, minute);
    await new Promise((resolve) => setImmediate(resolve));

    expect(github.requestsInFlight).toBe(1);

    github.resume();
    await vi.waitFor(() => {
      expect(pauses).toEqual([1, 2]);
    });
    await passTime(clock, 2 * minute);

    expect((await loaded).trees).toHaveLength(6);
  });

  it("sends requests one at a time after a secondary rate limit, until one succeeds", async () => {
    const { clock, github, core, limits } = rateLimitedSession();
    const names = Array.from({ length: 6 }, (_, n) => `acme/repo-${String(n)}`);
    await writeSettings({
      version: 1,
      repositories: names.map((name) => ({ name })),
    });
    for (const name of names) {
      github.addRepository(name, [{ number: 1, title: `Issue of ${name}` }]);
    }
    github.failWith(secondaryLimit(60 * 1000));
    await core.openList(all);
    await vi.waitFor(() => {
      expect(limits.at(-1)).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(0);
    });
    const sentBefore = github.requestsReceived;

    github.failWith(undefined);
    github.pause();
    await passTime(clock, minute);
    await new Promise((resolve) => setImmediate(resolve));

    expect(github.requestsReceived).toBe(sentBefore + 1);
    expect(github.requestsInFlight).toBe(1);

    // It succeeds, so the others go four at a time again.
    github.resume();
    github.pause();
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(4);
    });

    const loaded = await untilSettled(core, all, () => {
      github.resume();
      return Promise.resolve();
    });

    expect(loaded.trees).toHaveLength(6);
  });

  describe("below a tenth of a pool's budget", () => {
    /**
     * A session tracking `acme/api` and `acme/web`, whose GraphQL pool has
     * 460 of 5,000 points left until 12:30, with `acme/api`'s list and the
     * sidebar's counts read, six minutes ago.
     */
    async function lowSession() {
      const session = rateLimitedSession();
      const { clock, github, core } = session;
      await writeSettings({
        version: 1,
        repositories: [{ name: "acme/api" }, { name: "acme/web" }],
      });
      github.addRepository("acme/web", [{ number: 1, title: "Landing page" }]);
      github.setBudget("graphql", {
        remaining: 460,
        resetAt: startTime + 30 * minute,
      });
      await readUntilCounted(core);
      await openUntilLoaded(core, acmeApi);
      await passTime(clock, 6 * minute);
      return session;
    }

    it("stops reading screens and counts again on their own, and says so", async () => {
      const { github, core, limits } = await lowSession();
      const low: RateLimitState[] = [
        { pool: "graphql", status: "low", until: startTime + 30 * minute },
      ];
      const sentBefore = github.requestsReceived;

      // Opened again, and shown again as the window regains focus.
      const shown = await nextList(core, acmeApi, () => core.openList(acmeApi));
      await core.revalidate({ kind: "list", scope: acmeApi });
      await new Promise((resolve) => setImmediate(resolve));

      expect(limits.at(-1)).toEqual(low);
      expect(await core.getRateLimits()).toEqual(low);
      expect(shown.loading.status).toBe("current");
      expect(github.requestsReceived).toBe(sentBefore);
    });

    it("still reads what was never read, and a screen refreshed", async () => {
      const { github, core } = await lowSession();

      const web = await openUntilLoaded(core, acmeWeb);
      const api = await untilSettled(core, acmeApi, () =>
        core.refresh({ kind: "list", scope: acmeApi }),
      );

      expect(outline(web)).toEqual(["#1 Landing page"]);
      expect(api.loading.status).toBe("current");
      expect(github.requestsFor("acme/api")).toBe(2);
    });

    it("reads screens again on their own once GitHub has reset the pool", async () => {
      const { clock, github, core, limits } = await lowSession();

      await passTime(clock, 24 * minute);
      expect(limits.at(-1)).toEqual([]);
      const read = await untilSettled(core, acmeApi, () =>
        core.revalidate({ kind: "list", scope: acmeApi }),
      );

      expect(read.loading.status).toBe("current");
      expect(github.requestsFor("acme/api")).toBe(2);
    });
  });
});

describe("sidebar", () => {
  it("lists no tracked repositories before the settings file exists", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await core.getSidebar()).toEqual({
      status: "read",
      settings: { status: "writable" },
      firstLaunch: true,
      views: [],
      all: { openIssues: { status: "known", count: 0 } },
      repositories: [],
    });
  });

  it("lists the tracked repositories in the settings file's order", async () => {
    await writeSettings({
      version: 1,
      repositories: [
        { name: "acme/web", id: 1234567 },
        { name: "acme/api" },
        { name: "octo-org/tools", id: 7654321 },
      ],
      views: [{ id: "k3v9x2", name: "Open bugs", query: "is:open label:bug" }],
    });
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(sidebarLines(await core.getSidebar())).toEqual([
      "acme/web –",
      "acme/api –",
      "octo-org/tools –",
    ]);
  });

  it("reads the settings file from this platform's user data directory", async () => {
    const homedir = join(home, "octo");
    const userData =
      process.platform === "darwin"
        ? join(homedir, "Library", "Application Support", "Verdandi")
        : process.platform === "win32"
          ? join(homedir, "AppData", "Roaming", "Verdandi")
          : join(homedir, ".local", "share", "verdandi");
    await mkdir(userData, { recursive: true });
    await writeFile(
      join(userData, "settings.json"),
      JSON.stringify({ version: 1, repositories: [{ name: "acme/api" }] }),
    );
    const github = createFakeGitHub({ login: "octo-reader" });
    const machine = linuxWithGh();
    const core = createCore({
      github: () => github,
      runCommand: runnerOn(machine),
      host: machine.host,
      // Without VERDANDI_HOME, APPDATA or XDG_DATA_HOME, the default applies.
      settings: createSettingsFile({
        platform: process.platform,
        env: {},
        homedir,
      }),
      localState: createLocalStateFile(verdandiHome()),
    });

    cores.push(core);
    expect(sidebarLines(await core.getSidebar())).toEqual(["acme/api –"]);
  });

  it("says where the settings file is when it is not JSON", async () => {
    await writeFile(join(home, "settings.json"), '{ "repositories": [ }');
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await core.getSidebar()).toMatchObject({
      status: "read",
      repositories: [],
      views: [],
      settings: {
        status: "invalid",
        message: expect.stringContaining(
          `${join(home, "settings.json")}: not valid JSON:`,
        ) as unknown,
      },
    });
  });

  it("says which tracked repository has no owner/name", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "web" }],
      views: [],
    });
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await core.getSidebar()).toMatchObject({
      status: "read",
      repositories: [],
      views: [],
      settings: {
        status: "invalid",
        message: `${join(home, "settings.json")}: repositories[1].name is not "owner/name".`,
      },
    });
  });

  it("says why the settings file cannot be read", async () => {
    await mkdir(join(home, "settings.json"));
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await core.getSidebar()).toMatchObject({
      status: "read",
      repositories: [],
      views: [],
      settings: {
        status: "invalid",
        message: expect.stringContaining(
          `Cannot read ${join(home, "settings.json")}:`,
        ) as unknown,
      },
    });
  });
});

describe("sidebar counts", () => {
  it("reads every tracked repository's open-issue count in one request, without loading their issues", async () => {
    await writeSettings({
      version: 1,
      repositories: [
        { name: "acme/api" },
        { name: "acme/web" },
        { name: "octo-org/tools" },
      ],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 3, title: "Retry webhooks" },
      { number: 2, title: "Old crash", state: "closed" },
      { number: 1, title: "Crash on start" },
    ]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    github.addRepository("octo-org/tools", []);
    const core = createTestCore(github);

    let read: SidebarEntries | undefined;
    const pushed = await nextSidebar(core, async () => {
      read = await core.getSidebar();
    });

    expect(read).toEqual({
      status: "read",
      settings: { status: "writable" },
      firstLaunch: false,
      views: [],
      all: { openIssues: { status: "loading" } },
      repositories: [
        {
          repository: { owner: "acme", name: "api" },
          openIssues: { status: "loading" },
        },
        {
          repository: { owner: "acme", name: "web" },
          openIssues: { status: "loading" },
        },
        {
          repository: { owner: "octo-org", name: "tools" },
          openIssues: { status: "loading" },
        },
      ],
    });
    expect(sidebarLines(pushed)).toEqual([
      "acme/api 2",
      "acme/web 1",
      "octo-org/tools 0",
    ]);
    expect(github.requestsReceived).toBe(1);
    // That one request read no issues.
    expect(github.requestsFor("acme/api")).toBe(0);
    expect(github.requestsFor("acme/web")).toBe(0);
    expect(github.requestsFor("octo-org/tools")).toBe(0);
  });

  it("reads the counts of more than 100 tracked repositories 100 at a time", async () => {
    const names = Array.from(
      { length: 150 },
      (_, index) => `acme/service-${String(index + 1)}`,
    );
    await writeSettings({
      version: 1,
      repositories: names.map((name) => ({ name })),
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    for (const name of names) {
      github.addRepository(name, [{ number: 1, title: "Crash on start" }]);
    }
    const core = createTestCore(github);

    const sidebar = await readUntilCounted(core);

    expect(sidebarLines(sidebar)).toHaveLength(150);
    expect(
      sidebarLines(sidebar).filter((line) => !line.endsWith(" 1")),
    ).toEqual([]);
    expect(github.requestsReceived).toBe(2);
  });

  it("keeps the other counts when GitHub cannot read one tracked repository", async () => {
    await writeSettings({
      version: 1,
      repositories: [
        { name: "acme/api" },
        { name: "acme/gone" },
        { name: "acme/web" },
      ],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.addRepository("acme/web", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Broken footer" },
    ]);
    const core = createTestCore(github);

    expect(await readUntilCounted(core)).toEqual({
      status: "read",
      settings: { status: "writable" },
      firstLaunch: false,
      views: [],
      all: {
        openIssues: {
          status: "failed",
          message:
            "acme/gone: Unavailable or not accessible with this account: Could not resolve to a Repository with the name 'acme/gone'.",
        },
      },
      repositories: [
        {
          repository: { owner: "acme", name: "api" },
          openIssues: { status: "known", count: 1 },
        },
        {
          repository: { owner: "acme", name: "gone" },
          openIssues: {
            status: "failed",
            message:
              "Unavailable or not accessible with this account: Could not resolve to a Repository with the name 'acme/gone'.",
          },
        },
        {
          repository: { owner: "acme", name: "web" },
          openIssues: { status: "known", count: 2 },
        },
      ],
    });
    expect(github.requestsReceived).toBe(1);
  });

  it("says why no count could be read when GitHub cannot be asked", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.failWith({
      kind: "gh-failed",
      message: "error connecting to api.github.com",
    });
    const core = createTestCore(github);

    const sidebar = await readUntilCounted(core);

    expect(
      sidebar.status === "read" &&
        sidebar.repositories.map(({ openIssues }) => openIssues),
    ).toEqual([
      {
        status: "failed",
        message: "GitHub CLI (gh) failed: error connecting to api.github.com",
      },
      {
        status: "failed",
        message: "GitHub CLI (gh) failed: error connecting to api.github.com",
      },
    ]);
  });

  it("updates a count when its repository's list loads, without asking GitHub again", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    const core = createTestCore(github);
    expect(sidebarLines(await readUntilCounted(core))).toEqual([
      "acme/api 1",
      "acme/web 1",
    ]);

    github.addRepository("acme/api", [
      { number: 3, title: "Retry webhooks" },
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    const pushed = await nextSidebar(core, () =>
      openUntilLoaded(core, acmeApi),
    );

    expect(sidebarLines(pushed)).toEqual(["acme/api 3", "acme/web 1"]);
    // The counts, then the list's one page.
    expect(github.requestsReceived).toBe(2);
  });

  it("asks again for a count GitHub could not read as a screen opens, however recently it failed", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github);
    expect(sidebarLines(await readUntilCounted(core))).toEqual(["acme/api –"]);

    github.addRepository("acme/api", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    const pushed: SidebarEntries[] = [];
    core.on("sidebarChanged", (sidebar) => pushed.push(sidebar));
    await core.openIssuePage("I_acme/api#1");

    await vi.waitFor(() => {
      expect(pushed.map(sidebarLines)).toEqual([
        ["acme/api –"],
        ["acme/api 2"],
      ]);
    });
  });

  it("asks again for a count GitHub could not read as the window regains focus", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github);
    await readUntilCounted(core);

    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const pushed: SidebarEntries[] = [];
    core.on("sidebarChanged", (sidebar) => pushed.push(sidebar));
    await core.revalidate(undefined);

    await vi.waitFor(() => {
      expect(pushed.map(sidebarLines)).toEqual([
        ["acme/api –"],
        ["acme/api 1"],
      ]);
    });
  });

  it("keeps the count a list gave over an older one that arrives after it", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);
    github.pause("fetchRepositorySummaries");

    // GitHub counts one open issue, but its answer is slow to arrive.
    await core.getSidebar();
    github.addRepository("acme/api", [
      { number: 3, title: "Retry webhooks" },
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    const loaded = await nextSidebar(core, () =>
      openUntilLoaded(core, acmeApi),
    );
    expect(sidebarLines(loaded)).toEqual(["acme/api 3"]);
    const pushed: SidebarEntries[] = [];
    core.on("sidebarChanged", (sidebar) => pushed.push(sidebar));
    github.resume();
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(0);
    });

    expect(pushed.map(sidebarLines)).not.toContainEqual(["acme/api 1"]);
    expect(sidebarLines(await core.getSidebar())).toEqual(["acme/api 3"]);
  });

  it("keeps the count a list gave when the counts asked for before it fail", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github);
    github.pause("fetchRepositorySummaries");

    // GitHub cannot resolve acme/api yet, but its answer is slow to arrive.
    await core.getSidebar();
    github.addRepository("acme/api", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    await openUntilLoaded(core, acmeApi);
    github.resume();
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(0);
    });

    expect(sidebarLines(await core.getSidebar())).toEqual(["acme/api 2"]);
  });

  it("pushes the sidebar only when a count changes", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 2, title: "Usage endpoint" },
      { number: 1, title: "Launch billing", subIssues: ["acme/api#2"] },
    ]);
    const core = createTestCore(github);
    await readUntilCounted(core);
    const pushed: SidebarEntries[] = [];
    core.on("sidebarChanged", (sidebar) => pushed.push(sidebar));

    await openUntilLoaded(core, acmeApi);
    await core.setExpanded(acmeApi, "I_acme/api#1", false);
    await openUntilLoaded(core, acmeApi);

    expect(pushed).toEqual([]);
  });

  it("asks again only for the counts it could not read, the next time the sidebar is read", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);
    expect(sidebarLines(await readUntilCounted(core))).toEqual([
      "acme/api 1",
      "acme/web –",
    ]);

    github.addRepository("acme/web", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Broken footer" },
    ]);
    github.addRepository("acme/api", [
      { number: 2, title: "Retry webhooks" },
      { number: 1, title: "Crash on start" },
    ]);

    // acme/api's count is known for the session; only acme/web's is asked.
    expect(sidebarLines(await readUntilCounted(core))).toEqual([
      "acme/api 1",
      "acme/web 2",
    ]);
    expect(github.requestsReceived).toBe(2);
  });

  it("asks for the counts once when the sidebar is read twice at once", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);
    github.pause();

    const counted = readUntilCounted(core);
    await core.getSidebar();
    github.resume();

    expect(sidebarLines(await counted)).toEqual(["acme/api 1"]);
    expect(github.requestsReceived).toBe(1);
  });

  it("counts All's open issues as every tracked repository's together", async () => {
    await writeSettings({
      version: 1,
      repositories: [
        { name: "acme/api" },
        { name: "acme/web" },
        { name: "octo-org/tools" },
      ],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    github.addRepository("acme/web", [
      { number: 2, title: "Old crash", state: "closed" },
      { number: 1, title: "Broken footer" },
    ]);
    github.addRepository("octo-org/tools", []);
    const core = createTestCore(github);

    const read = await core.getSidebar();
    expect(read.status === "read" && read.all).toEqual({
      openIssues: { status: "loading" },
    });
    const counted = await readUntilCounted(core);
    expect(counted.status === "read" && counted.all).toEqual({
      openIssues: { status: "known", count: 3 },
    });
  });

  it("leaves All's count unknown, naming why, while a tracked repository's is", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/gone" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);

    const sidebar = await readUntilCounted(core);

    expect(sidebar.status === "read" && sidebar.all).toEqual({
      openIssues: {
        status: "failed",
        message:
          "acme/gone: Unavailable or not accessible with this account: Could not resolve to a Repository with the name 'acme/gone'.",
      },
    });
  });

  it("reads the counts again, showing them meanwhile, when a screen opens more than five minutes after they were read", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await readUntilCounted(core);
    const pushed: SidebarEntries[] = [];
    core.on("sidebarChanged", (sidebar) => pushed.push(sidebar));

    github.addRepository("acme/web", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Broken footer" },
    ]);
    clock.advance(5 * minute);
    await openUntilLoaded(core, acmeApi);
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(0);
    });
    expect(pushed).toEqual([]);

    clock.advance(1);
    await openUntilLoaded(core, acmeApi);
    await vi.waitFor(() => {
      expect(pushed.map(sidebarLines)).toEqual([["acme/api 1", "acme/web 2"]]);
    });
  });

  it("reads the counts again when the window regains focus more than five minutes after they were read", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await readUntilCounted(core);

    github.addRepository("acme/api", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    clock.advance(5 * minute + 1);
    const pushed = await nextSidebar(core, () => core.revalidate(undefined));

    expect(sidebarLines(pushed)).toEqual(["acme/api 2"]);
  });

  it("reads the counts again on a refresh, however recently they were read", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);
    await readUntilCounted(core);

    github.addRepository("acme/api", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    const pushed = await nextSidebar(core, () => core.refresh(undefined));

    expect(sidebarLines(pushed)).toEqual(["acme/api 2"]);
  });

  it("asks GitHub nothing while no repository is tracked", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github);

    await core.getSidebar();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(github.requestsReceived).toBe(0);
  });
});

describe("repository list", () => {
  it("shows a tracked repository's open issues", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 3, title: "Retry webhooks" },
      { number: 1, title: "Crash on start" },
    ]);
    const core = createTestCore(github);

    expect(outline(await openUntilLoaded(core, acmeApi))).toEqual([
      "#3 Retry webhooks",
      "#1 Crash on start",
    ]);
  });

  it("shows the issues page by page as they arrive", async () => {
    const github = createFakeGitHub({ login: "octo-reader", issuesPerPage: 2 });
    github.addRepository("acme/api", [
      { number: 5, title: "Dark mode", updatedAt: "2026-09-05T00:00:00Z" },
      { number: 4, title: "Audit trail", updatedAt: "2026-09-04T00:00:00Z" },
      { number: 2, title: "CSV import", updatedAt: "2026-09-02T00:00:00Z" },
    ]);
    const core = createTestCore(github);
    const pushed: IssueList[] = [];
    core.on("listChanged", (list) => pushed.push(list));

    await openUntilLoaded(core, acmeApi);

    expect(
      pushed.map((list) => ({
        outline: outline(list),
        loading: list.loading.status,
      })),
    ).toEqual([
      { outline: [], loading: "loading" },
      { outline: ["#5 Dark mode", "#4 Audit trail"], loading: "loading" },
      {
        outline: ["#5 Dark mode", "#4 Audit trail", "#2 CSV import"],
        loading: "current",
      },
    ]);
  });

  it("loads only the opened repository, not every tracked one", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
      views: [],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    const core = createTestCore(github);

    await core.getSidebar();
    await openUntilLoaded(core, acmeApi);

    expect(github.requestsFor("acme/api")).toBeGreaterThan(0);
    expect(github.requestsFor("acme/web")).toBe(0);
  });

  it("shows a loaded repository again without asking GitHub", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 2, title: "Launch billing", subIssues: ["acme/api#1"] },
      { number: 1, title: "Meter requests", state: "closed" },
    ]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    const core = createTestCore(github);

    const first = await openUntilLoaded(core, acmeApi);
    await openUntilLoaded(core, acmeWeb);
    const requestsBefore = github.requestsFor("acme/api");
    const revisited = await openUntilLoaded(core, acmeApi);

    expect(revisited).toEqual(first);
    expect(outline(revisited)).toEqual([
      "#2 Launch billing",
      "  #1 Meter requests · closed",
    ]);
    expect(github.requestsFor("acme/api")).toBe(requestsBefore);
  });

  it("says a repository GitHub will not show is unavailable, never why it guesses", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await openUntilLoaded(core, acmeApi)).toEqual({
      scope: acmeApi,
      trees: [],
      repositories: [],
      loading: {
        status: "failed",
        problem: { kind: "unavailable", access: undefined },
      },
    });
  });

  it("tries a repository that failed again when it is reopened", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github);

    await openUntilLoaded(core, acmeApi);
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const reopened = await openUntilLoaded(core, acmeApi);

    expect(outline(reopened)).toEqual(["#1 Crash on start"]);
    expect(reopened.loading.status).toBe("current");
  });

  it("does not load a repository twice when it is reopened mid-load", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    const core = createTestCore(github);
    github.pause();

    await core.openList(acmeApi);
    await core.openList(acmeWeb);
    const revisited = openUntilLoaded(core, acmeApi);
    github.resume();

    expect(outline(await revisited)).toEqual(["#1 Crash on start"]);
    // Its one page was asked for once.
    expect(github.requestsFor("acme/api")).toBe(1);
  });

  it("keeps issues in memory only", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);

    await core.getSidebar();
    await openUntilLoaded(core, acmeApi);

    expect(await readdir(home, { recursive: true })).toEqual(["settings.json"]);
  });

  it("names a repository without regard to case, as GitHub does", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);

    const first = await openUntilLoaded(core, acmeApi);
    const requestsBefore = github.requestsFor("acme/api");
    const shouted: Scope = {
      kind: "repository",
      repository: { owner: "Acme", name: "API" },
    };
    const again = await openUntilLoaded(core, shouted);

    expect(again).toEqual({ ...first, scope: shouted });
    expect(github.requestsFor("acme/api")).toBe(requestsBefore);
  });
});

describe("sub-issue forest", () => {
  it("nests sub-issues under their parent issue, in GitHub's order", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 4, title: "Invoice line items" },
      { number: 3, title: "Usage endpoint", subIssues: ["acme/api#4"] },
      { number: 2, title: "Rate cards" },
      {
        number: 1,
        title: "Launch billing",
        subIssues: ["acme/api#3", "acme/api#2"],
      },
    ]);
    const core = createTestCore(github);

    expect(outline(await openUntilLoaded(core, acmeApi))).toEqual([
      "#1 Launch billing",
      "  #3 Usage endpoint",
      "    #4 Invoice line items",
      "  #2 Rate cards",
    ]);
  });

  it("lists parent issues first, then the most recently updated", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 6, title: "Typo in README", updatedAt: "2026-09-03T00:00:00Z" },
      {
        number: 5,
        title: "Harden webhooks",
        updatedAt: "2026-08-01T00:00:00Z",
        subIssues: ["acme/api#1"],
      },
      { number: 4, title: "Flaky test", updatedAt: "2026-09-20T00:00:00Z" },
      {
        number: 3,
        title: "Launch billing",
        updatedAt: "2026-09-10T00:00:00Z",
        subIssues: ["acme/api#2"],
      },
      { number: 2, title: "Rate cards", updatedAt: "2026-09-25T00:00:00Z" },
      { number: 1, title: "Retry budget", updatedAt: "2026-07-01T00:00:00Z" },
    ]);
    const core = createTestCore(github);

    expect(outline(await openUntilLoaded(core, acmeApi))).toEqual([
      "#3 Launch billing",
      "  #2 Rate cards",
      "#5 Harden webhooks",
      "  #1 Retry budget",
      "#4 Flaky test",
      "#6 Typo in README",
    ]);
  });

  it("keeps closed sub-issues in place", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 3, title: "Usage endpoint" },
      { number: 2, title: "Meter requests", state: "closed" },
      {
        number: 1,
        title: "Launch billing",
        subIssues: ["acme/api#2", "acme/api#3"],
      },
    ]);
    const core = createTestCore(github);

    expect(outline(await openUntilLoaded(core, acmeApi))).toEqual([
      "#1 Launch billing",
      "  #2 Meter requests · closed",
      "  #3 Usage endpoint",
    ]);
  });

  it("leaves out closed issues without open sub-issues, and counts them", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 5, title: "Old crash", state: "closed" },
      {
        number: 4,
        title: "Finished rollout",
        state: "closed",
        subIssues: ["acme/api#3"],
      },
      { number: 3, title: "Finished step", state: "closed" },
      { number: 2, title: "Meter requests", state: "closed" },
      { number: 1, title: "Launch billing", subIssues: ["acme/api#2"] },
    ]);
    const core = createTestCore(github);
    const list = await openUntilLoaded(core, acmeApi);

    expect(outline(list)).toEqual([
      "#1 Launch billing",
      "  #2 Meter requests · closed",
    ]);
    expect(list.loading).toEqual({
      status: "current",
      updatedAt: startTime,
      openIssues: 1,
      closedNotListed: 3,
    });
  });

  it("keeps a closed issue as the parent of its open sub-issues", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 5, title: "Rate cards" },
      { number: 4, title: "Usage endpoint" },
      {
        number: 3,
        title: "Metering",
        state: "closed",
        subIssues: ["acme/api#4"],
      },
      { number: 2, title: "Meter requests", state: "closed" },
      {
        number: 1,
        title: "Launch billing",
        state: "closed",
        subIssues: ["acme/api#2", "acme/api#3", "acme/api#5"],
      },
    ]);
    const core = createTestCore(github);
    const list = await openUntilLoaded(core, acmeApi);

    expect(outline(list)).toEqual([
      "#1 Launch billing · closed",
      "  #2 Meter requests · closed",
      "  #3 Metering · closed",
      "    #4 Usage endpoint",
      "  #5 Rate cards",
    ]);
    expect(list.loading).toEqual({
      status: "current",
      updatedAt: startTime,
      openIssues: 2,
      closedNotListed: 0,
    });
  });

  it("keeps a closed issue as the parent of its open sub-issues through another repository", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 7, title: "Usage endpoint" },
      {
        number: 5,
        title: "Launch billing",
        state: "closed",
        subIssues: ["acme/web#3"],
      },
      { number: 4, title: "Old crash", state: "closed" },
    ]);
    github.addRepository("acme/web", [
      { number: 3, title: "Usage dashboard", subIssues: ["acme/api#7"] },
    ]);
    const core = createTestCore(github);
    const list = await openUntilLoaded(core, acmeApi);

    expect(outline(list)).toEqual([
      "#5 Launch billing · closed",
      "  acme/web#3 Usage dashboard",
      "    #7 Usage endpoint",
    ]);
    expect(list.loading).toEqual({
      status: "current",
      updatedAt: startTime,
      openIssues: 1,
      closedNotListed: 1,
    });
  });

  it("names sub-issues from other repositories in full, and tags external ones", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      {
        number: 1,
        title: "Launch billing",
        subIssues: ["acme/web#7", "vendor/sdk#3"],
      },
    ]);
    github.addRepository("acme/web", [
      { number: 8, title: "Usage chart", state: "closed" },
      { number: 7, title: "Usage page", subIssues: ["acme/web#8"] },
    ]);
    github.addRepository("vendor/sdk", [
      { number: 4, title: "Batch events" },
      { number: 3, title: "Emit usage events", subIssues: ["vendor/sdk#4"] },
    ]);
    const core = createTestCore(github);

    expect(outline(await openUntilLoaded(core, acmeApi))).toEqual([
      "#1 Launch billing",
      "  acme/web#7 Usage page",
      "    acme/web#8 Usage chart · closed",
      "  vendor/sdk#3 Emit usage events · external",
      "    vendor/sdk#4 Batch events · external",
    ]);
  });

  it("puts a sub-issue whose parent issue lives in another repository at the top level, naming the parent", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 2, title: "Support the v3 handshake" },
      { number: 1, title: "Usage endpoint" },
    ]);
    github.addRepository("acme/web", [
      { number: 5, title: "Usage dashboard", subIssues: ["acme/api#1"] },
    ]);
    github.addRepository("upstream/protocol", [
      { number: 7, title: "Protocol v3 rollout", subIssues: ["acme/api#2"] },
    ]);
    const core = createTestCore(github);
    const list = await openUntilLoaded(core, acmeApi);

    expect(outline(list)).toEqual([
      "#2 Support the v3 handshake · ↑ upstream/protocol#7 external",
      "#1 Usage endpoint · ↑ acme/web#5",
    ]);
    expect(list.trees.map((tree) => tree.parent)).toEqual([
      {
        id: "I_upstream/protocol#7",
        reference: "upstream/protocol#7",
        title: "Protocol v3 rollout",
        external: true,
      },
      {
        id: "I_acme/web#5",
        reference: "acme/web#5",
        title: "Usage dashboard",
        external: false,
      },
    ]);
    expect(outline(await openUntilLoaded(core, acmeWeb))).toEqual([
      "#5 Usage dashboard",
      "  acme/api#1 Usage endpoint",
    ]);
  });

  it("shows an issue once when it nests below another one through a different repository", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 2, title: "Usage endpoint" },
      { number: 1, title: "Launch billing", subIssues: ["acme/web#5"] },
    ]);
    github.addRepository("acme/web", [
      { number: 5, title: "Usage dashboard", subIssues: ["acme/api#2"] },
    ]);
    const core = createTestCore(github);

    expect(outline(await openUntilLoaded(core, acmeApi))).toEqual([
      "#1 Launch billing",
      "  acme/web#5 Usage dashboard · external",
      "    #2 Usage endpoint",
    ]);
  });

  it("shows each issue's labels, sub-issue progress and blocking counts", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      {
        number: 3,
        title: "Usage endpoint",
        labels: [
          { name: "api", color: "0075ca" },
          { name: "good first issue", color: "7057ff" },
        ],
        blocking: { open: 2, total: 2 },
      },
      { number: 2, title: "Meter requests", state: "closed" },
      {
        number: 1,
        title: "Launch billing",
        labels: [{ name: "roadmap", color: "3e4b9e" }],
        subIssues: ["acme/api#2", "acme/api#3"],
        blockedBy: { open: 1, total: 3 },
        blocking: { open: 0, total: 1 },
      },
    ]);
    const core = createTestCore(github);
    const [tree] = (await openUntilLoaded(core, acmeApi)).trees;

    expect(tree?.issue).toEqual({
      id: "I_acme/api#1",
      repository: { owner: "acme", name: "api" },
      reference: "#1",
      title: "Launch billing",
      state: "open",
      url: "https://github.com/acme/api/issues/1",
      labels: [{ name: "roadmap", color: "3e4b9e" }],
      external: false,
      subIssueProgress: { closed: 1, total: 2 },
      blockedBy: { open: 1, total: 3 },
      blocking: { open: 0, total: 1 },
    });
    expect(tree?.subIssues[1]?.issue).toEqual({
      id: "I_acme/api#3",
      repository: { owner: "acme", name: "api" },
      reference: "#3",
      title: "Usage endpoint",
      state: "open",
      url: "https://github.com/acme/api/issues/3",
      labels: [
        { name: "api", color: "0075ca" },
        { name: "good first issue", color: "7057ff" },
      ],
      external: false,
      subIssueProgress: { closed: 0, total: 0 },
      blockedBy: { open: 0, total: 0 },
      blocking: { open: 2, total: 2 },
    });
  });

  it("nests an open sub-issue once its parent issue's page arrives", async () => {
    const github = createFakeGitHub({ login: "octo-reader", issuesPerPage: 1 });
    github.addRepository("acme/api", [
      { number: 2, title: "Usage endpoint" },
      { number: 1, title: "Launch billing", subIssues: ["acme/api#2"] },
    ]);
    const core = createTestCore(github);
    const pushed: string[][] = [];
    core.on("listChanged", (list) => pushed.push(outline(list)));

    await openUntilLoaded(core, acmeApi);

    expect(pushed).toEqual([
      [],
      ["#2 Usage endpoint · ↑ #1"],
      ["#1 Launch billing", "  #2 Usage endpoint"],
    ]);
    // Both issues came with their pages; neither was read on its own.
    expect(github.requestsFor("acme/api")).toBe(2);
  });

  it("reads the issues a list shows beyond its open ones up to 100 at a time", async () => {
    const closed = (from: number) =>
      Array.from({ length: 75 }, (_, index) => from + index);
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      ...[...closed(100), ...closed(200)].map((number) => ({
        number,
        title: `Step ${String(number)}`,
        state: "closed" as const,
      })),
      {
        number: 2,
        title: "Webhooks",
        subIssues: closed(200).map((number) => `acme/api#${String(number)}`),
      },
      {
        number: 1,
        title: "Launch billing",
        subIssues: closed(100).map((number) => `acme/api#${String(number)}`),
      },
    ]);
    const core = createTestCore(github);
    const list = await openUntilLoaded(core, acmeApi);

    expect(outline(list)).toHaveLength(152);
    // One page of open issues, then 150 closed sub-issues in two requests.
    expect(github.requestsFor("acme/api")).toBe(3);
  });
});

describe("expansion", () => {
  /** acme/api with two trees, one of them nested two levels deep. */
  function billingRepository() {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 5, title: "Dark mode" },
      { number: 4, title: "Invoice line items" },
      { number: 3, title: "Usage endpoint", subIssues: ["acme/api#4"] },
      { number: 2, title: "Webhooks", subIssues: ["acme/api#5"] },
      { number: 1, title: "Launch billing", subIssues: ["acme/api#3"] },
    ]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    return github;
  }

  it("starts with every tree fully expanded", async () => {
    const core = createTestCore(billingRepository());

    expect(collapsedIssues(await openUntilLoaded(core, acmeApi))).toEqual([]);
  });

  it("collapses and expands one issue's sub-issues", async () => {
    const core = createTestCore(billingRepository());
    await openUntilLoaded(core, acmeApi);

    const collapsed = await nextList(core, acmeApi, () =>
      core.setExpanded(acmeApi, "I_acme/api#3", false),
    );
    expect(collapsedIssues(collapsed)).toEqual(["#3"]);
    expect(outline(collapsed)).toEqual([
      "#2 Webhooks",
      "  #5 Dark mode",
      "#1 Launch billing",
      "  #3 Usage endpoint",
      "    #4 Invoice line items",
    ]);

    const expanded = await nextList(core, acmeApi, () =>
      core.setExpanded(acmeApi, "I_acme/api#3", true),
    );
    expect(collapsedIssues(expanded)).toEqual([]);
  });

  it("collapses and expands every tree at once", async () => {
    const core = createTestCore(billingRepository());
    await openUntilLoaded(core, acmeApi);
    await core.setExpanded(acmeApi, "I_acme/api#2", false);

    const collapsed = await nextList(core, acmeApi, () =>
      core.setAllExpanded(acmeApi, false),
    );
    expect(collapsedIssues(collapsed)).toEqual(["#2", "#5", "#1", "#3", "#4"]);

    await core.setExpanded(acmeApi, "I_acme/api#1", true);
    const expanded = await nextList(core, acmeApi, () =>
      core.setAllExpanded(acmeApi, true),
    );
    expect(collapsedIssues(expanded)).toEqual([]);
  });

  it("collapses issues that load after every tree was collapsed", async () => {
    const github = createFakeGitHub({ login: "octo-reader", issuesPerPage: 1 });
    github.addRepository("acme/api", [
      { number: 3, title: "Usage endpoint" },
      { number: 2, title: "Launch billing", subIssues: ["acme/api#1"] },
      { number: 1, title: "Meter requests", state: "closed" },
    ]);
    const core = createTestCore(github);
    github.pause();
    const loaded = openUntilLoaded(core, acmeApi);
    await core.setAllExpanded(acmeApi, false);
    github.resume();

    expect(collapsedIssues(await loaded)).toEqual(["#2", "#1", "#3"]);
  });

  it("keeps each list's expansion when another list was opened meanwhile", async () => {
    const core = createTestCore(billingRepository());
    await openUntilLoaded(core, acmeApi);
    await core.setExpanded(acmeApi, "I_acme/api#1", false);

    await openUntilLoaded(core, acmeWeb);
    const reopened = await openUntilLoaded(core, acmeApi);

    expect(collapsedIssues(reopened)).toEqual(["#1"]);
  });
});

describe("All", () => {
  it("merges the open issues of every tracked repository into one forest", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "octo-org/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 3, title: "Retry webhooks", updatedAt: "2026-09-03T00:00:00Z" },
      { number: 1, title: "Crash on start", updatedAt: "2026-09-01T00:00:00Z" },
    ]);
    github.addRepository("octo-org/web", [
      { number: 2, title: "Broken footer", updatedAt: "2026-09-02T00:00:00Z" },
    ]);
    const core = createTestCore(github);
    const list = await openUntilLoaded(core, all);

    expect(outline(list)).toEqual([
      "acme/api #3 Retry webhooks",
      "octo-org/web #2 Broken footer",
      "acme/api #1 Crash on start",
    ]);
    expect(list.loading).toEqual({
      status: "current",
      updatedAt: startTime,
      openIssues: 3,
      closedNotListed: 0,
    });
  });

  it("shows each issue once, below its parent issue in another tracked repository", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "octo-org/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 2, title: "Usage endpoint" },
      { number: 1, title: "Launch billing", subIssues: ["octo-org/web#5"] },
    ]);
    github.addRepository("octo-org/web", [
      { number: 6, title: "Broken footer" },
      { number: 5, title: "Usage dashboard", subIssues: ["acme/api#2"] },
    ]);
    const core = createTestCore(github);

    // octo-org/web#5 and acme/api#2 are open issues of tracked repositories
    // and sub-issues too; each shows once, under its parent issue.
    expect(outline(await openUntilLoaded(core, all))).toEqual([
      "acme/api #1 Launch billing",
      "  octo-org/web #5 Usage dashboard",
      "    acme/api #2 Usage endpoint",
      "octo-org/web #6 Broken footer",
    ]);
  });

  it("names a parent issue outside every tracked repository with a chip", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      {
        number: 2,
        title: "Support the v3 handshake",
        updatedAt: "2026-09-03T00:00:00Z",
      },
      { number: 1, title: "Usage endpoint" },
    ]);
    github.addRepository("acme/web", [
      {
        number: 5,
        title: "Usage dashboard",
        subIssues: ["acme/api#1"],
      },
      {
        number: 4,
        title: "Show the protocol version",
        updatedAt: "2026-09-02T00:00:00Z",
      },
    ]);
    github.addRepository("upstream/protocol", [
      {
        number: 7,
        title: "Protocol v3 rollout",
        subIssues: ["acme/api#2", "acme/web#4"],
      },
    ]);
    const core = createTestCore(github);
    const list = await openUntilLoaded(core, all);

    expect(outline(list)).toEqual([
      "acme/web #5 Usage dashboard",
      "  acme/api #1 Usage endpoint",
      "acme/api #2 Support the v3 handshake · ↑ upstream/protocol#7 external",
      "acme/web #4 Show the protocol version · ↑ upstream/protocol#7 external",
    ]);
    expect(list.trees[1]?.parent).toEqual({
      id: "I_upstream/protocol#7",
      reference: "upstream/protocol#7",
      title: "Protocol v3 rollout",
      external: true,
    });
  });

  it("nests an issue below a tracked ancestor through an external parent issue", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 7, title: "Usage endpoint" }]);
    github.addRepository("vendor/sdk", [
      { number: 8, title: "Emit usage events", subIssues: ["acme/api#7"] },
    ]);
    github.addRepository("acme/web", [
      {
        number: 3,
        title: "Launch billing",
        state: "closed",
        subIssues: ["vendor/sdk#8"],
      },
    ]);
    const core = createTestCore(github);

    expect(outline(await openUntilLoaded(core, all))).toEqual([
      "acme/web #3 Launch billing · closed",
      "  vendor/sdk #8 Emit usage events · external",
      "    acme/api #7 Usage endpoint",
    ]);
  });

  it("gives every issue its repository for the chip, and names it by number", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "octo-org/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      {
        number: 1,
        title: "Launch billing",
        subIssues: ["octo-org/web#2", "vendor/sdk#3"],
      },
    ]);
    github.addRepository("octo-org/web", [{ number: 2, title: "Usage page" }]);
    github.addRepository("vendor/sdk", [
      { number: 3, title: "Emit usage events" },
    ]);
    const core = createTestCore(github);
    const [tree] = (await openUntilLoaded(core, all)).trees;

    expect(
      [tree, ...(tree?.subIssues ?? [])].map((node) => {
        const { repository, reference, external } = node?.issue ?? {};
        return { repository, reference, external };
      }),
    ).toEqual([
      {
        repository: { owner: "acme", name: "api" },
        reference: "#1",
        external: false,
      },
      {
        repository: { owner: "octo-org", name: "web" },
        reference: "#2",
        external: false,
      },
      {
        repository: { owner: "vendor", name: "sdk" },
        reference: "#3",
        external: true,
      },
    ]);
  });

  it("leaves out closed issues without open sub-issues, and counts those of every tracked repository", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 3, title: "Finished rollout", state: "closed" },
      { number: 2, title: "Meter requests", state: "closed" },
      { number: 1, title: "Launch billing", subIssues: ["acme/web#4"] },
    ]);
    github.addRepository("acme/web", [
      { number: 6, title: "Broken footer" },
      { number: 5, title: "Old crash", state: "closed" },
      { number: 4, title: "Usage chart", state: "closed" },
    ]);
    const core = createTestCore(github);
    const list = await openUntilLoaded(core, all);

    expect(outline(list)).toEqual([
      "acme/api #1 Launch billing",
      "  acme/web #4 Usage chart · closed",
      "acme/web #6 Broken footer",
    ]);
    expect(list.loading).toEqual({
      status: "current",
      updatedAt: startTime,
      openIssues: 2,
      closedNotListed: 3,
    });
  });

  it("keeps a closed issue of a tracked repository as the ancestor of open issues in another", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 7, title: "Usage endpoint" },
      { number: 6, title: "Old crash", state: "closed" },
    ]);
    github.addRepository("acme/web", [
      {
        number: 3,
        title: "Launch billing",
        state: "closed",
        subIssues: ["acme/api#7"],
      },
      { number: 2, title: "Dark mode", state: "closed" },
    ]);
    const core = createTestCore(github);
    const list = await openUntilLoaded(core, all);

    expect(outline(list)).toEqual([
      "acme/web #3 Launch billing · closed",
      "  acme/api #7 Usage endpoint",
    ]);
    expect(list.loading).toEqual({
      status: "current",
      updatedAt: startTime,
      openIssues: 1,
      closedNotListed: 2,
    });
  });

  it("loads every tracked repository when it is opened, and not before", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    const core = createTestCore(github);

    await readUntilCounted(core);
    expect(github.requestsFor("acme/api")).toBe(0);
    expect(github.requestsFor("acme/web")).toBe(0);

    await openUntilLoaded(core, all);
    expect(github.requestsFor("acme/api")).toBe(1);
    expect(github.requestsFor("acme/web")).toBe(1);
  });

  it("shows each repository's issues as they arrive", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader", issuesPerPage: 1 });
    github.addRepository("acme/api", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    github.addRepository("acme/web", [
      { number: 2, title: "Audit trail" },
      { number: 1, title: "Broken footer" },
    ]);
    const core = createTestCore(github);
    const pushed: IssueList[] = [];
    core.on("listChanged", (list) => pushed.push(list));

    const loaded = await openUntilLoaded(core, all);

    const firstRows = pushed.find((list) => list.trees.length > 0);
    expect(firstRows?.loading.status).toBe("loading");
    expect(outline(loaded)).toHaveLength(4);
  });

  it("reuses a repository whose list has loaded, reading none of it again", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 2, title: "Meter requests", state: "closed" },
      { number: 1, title: "Launch billing", subIssues: ["acme/api#2"] },
    ]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    const core = createTestCore(github);

    await openUntilLoaded(core, acmeApi);
    // Its one page, and its closed sub-issue by ID.
    expect(github.requestsFor("acme/api")).toBe(2);
    const list = await openUntilLoaded(core, all);

    expect(outline(list)).toEqual([
      "acme/api #1 Launch billing",
      "  acme/api #2 Meter requests · closed",
      "acme/web #1 Broken footer",
    ]);
    expect(github.requestsFor("acme/api")).toBe(2);
    expect(github.requestsFor("acme/web")).toBe(1);
  });

  it("leaves the repository lists nothing to read once it has loaded", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 2, title: "Meter requests", state: "closed" },
      { number: 1, title: "Launch billing", subIssues: ["acme/api#2"] },
    ]);
    github.addRepository("acme/web", [
      { number: 1, title: "Usage page", subIssues: ["acme/api#1"] },
    ]);
    const core = createTestCore(github);

    await openUntilLoaded(core, all);
    const requestsBefore = github.requestsReceived;

    expect(outline(await openUntilLoaded(core, acmeApi))).toEqual([
      "#1 Launch billing · ↑ acme/web#1",
      "  #2 Meter requests · closed",
    ]);
    expect(outline(await openUntilLoaded(core, acmeWeb))).toEqual([
      "#1 Usage page",
      "  acme/api#1 Launch billing",
      "    acme/api#2 Meter requests · closed",
    ]);
    expect(github.requestsReceived).toBe(requestsBefore);
  });

  it("reads an issue once when All needs it while a repository's list is reading it", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 2, title: "Meter requests", state: "closed" },
      { number: 1, title: "Launch billing", subIssues: ["acme/api#2"] },
    ]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    const core = createTestCore(github);
    github.pause("fetchIssues");

    await core.openList(acmeApi);
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });
    // All shows acme/api's issues while their closed sub-issue is still
    // being read for acme/api's list.
    const shown = new Promise<void>((resolve) => {
      core.on("listChanged", (list) => {
        if (list.scope.kind === "all" && list.trees.length > 0) resolve();
      });
    });
    const loaded = openUntilLoaded(core, all);
    await shown;
    github.resume();

    expect(outline(await loaded)).toEqual([
      "acme/api #1 Launch billing",
      "  acme/api #2 Meter requests · closed",
      "acme/web #1 Broken footer",
    ]);
    // Its one page, and its closed sub-issue by ID.
    expect(github.requestsFor("acme/api")).toBe(2);
  });

  it("updates the counts of the repositories it loads, without asking GitHub again", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    const core = createTestCore(github);
    expect(sidebarLines(await readUntilCounted(core))).toEqual([
      "acme/api 1",
      "acme/web 1",
    ]);

    github.addRepository("acme/api", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    github.addRepository("acme/web", [
      { number: 3, title: "Audit trail" },
      { number: 2, title: "CSV import" },
      { number: 1, title: "Broken footer" },
    ]);
    const pushed: SidebarEntries[] = [];
    core.on("sidebarChanged", (sidebar) => pushed.push(sidebar));
    await openUntilLoaded(core, all);

    expect(
      sidebarLines(pushed.at(-1) ?? { status: "failed", message: "" }),
    ).toEqual(["acme/api 2", "acme/web 3"]);
    // The counts, then one page of each repository.
    expect(github.requestsReceived).toBe(3);
  });

  it("marks a tracked repository GitHub will not show as unavailable, and shows the others", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/gone" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);
    const list = await openUntilLoaded(core, all);

    expect(outline(list)).toEqual(["acme/api #1 Crash on start"]);
    expect(list.loading).toEqual({
      status: "current",
      updatedAt: startTime,
      openIssues: 1,
      closedNotListed: 0,
    });
    expect(list.repositories).toEqual([
      {
        repository: { owner: "acme", name: "api" },
        loading: { status: "current", updatedAt: startTime },
      },
      {
        repository: { owner: "acme", name: "gone" },
        loading: {
          status: "failed",
          problem: { kind: "unavailable", access: undefined },
        },
      },
    ]);
  });

  it("tries only the repositories that failed again when it is reopened", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/gone" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);
    await openUntilLoaded(core, all);

    github.addRepository("acme/gone", [{ number: 4, title: "Found again" }]);
    const reopened = await openUntilLoaded(core, all);

    expect(outline(reopened)).toEqual([
      "acme/gone #4 Found again",
      "acme/api #1 Crash on start",
    ]);
    expect(reopened.loading.status).toBe("current");
    expect(github.requestsFor("acme/api")).toBe(1);
  });

  it("says why when the settings file cannot be read", async () => {
    await writeFile(join(home, "settings.json"), '{ "repositories": [ }');
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github);

    expect(await openUntilLoaded(core, all)).toEqual({
      scope: all,
      trees: [],
      repositories: [],
      loading: {
        status: "failed",
        problem: {
          kind: "error",
          message: expect.stringContaining(
            `${join(home, "settings.json")}: not valid JSON:`,
          ) as unknown,
        },
      },
    });
    expect(github.requestsReceived).toBe(0);
  });

  it("has no open issues, asking GitHub nothing, while no repository is tracked", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github);

    expect(await openUntilLoaded(core, all)).toEqual({
      scope: all,
      trees: [],
      repositories: [],
      loading: {
        status: "current",
        updatedAt: startTime,
        openIssues: 0,
        closedNotListed: 0,
      },
    });
    expect(github.requestsReceived).toBe(0);
  });

  it("keeps its expansion apart from the repository lists'", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 2, title: "Usage endpoint" },
      { number: 1, title: "Launch billing", subIssues: ["acme/api#2"] },
    ]);
    const core = createTestCore(github);
    await openUntilLoaded(core, acmeApi);
    await openUntilLoaded(core, all);

    const collapsed = await nextList(core, all, () =>
      core.setExpanded(all, "I_acme/api#1", false),
    );
    expect(collapsedIssues(collapsed)).toEqual(["#1"]);
    expect(collapsedIssues(await openUntilLoaded(core, acmeApi))).toEqual([]);

    await core.setAllExpanded(acmeApi, false);
    await core.setExpanded(all, "I_acme/api#1", true);
    expect(collapsedIssues(await openUntilLoaded(core, all))).toEqual([]);
  });

  it("merges a repository the settings file lists twice once", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "Acme/API" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);
    const list = await openUntilLoaded(core, all);

    expect(outline(list)).toEqual(["acme/api #1 Crash on start"]);
    expect(list.loading).toEqual({
      status: "current",
      updatedAt: startTime,
      openIssues: 1,
      closedNotListed: 0,
    });
  });
});

describe("freshness", () => {
  it("says a loaded list is current as of when GitHub was read", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);

    expect((await openUntilLoaded(core, acmeApi)).loading).toEqual({
      status: "current",
      updatedAt: startTime,
      openIssues: 1,
      closedNotListed: 0,
    });
  });

  it("reads a list again in the background when it is opened more than five minutes after it was read", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openUntilLoaded(core, acmeApi);
    await openUntilLoaded(core, acmeWeb);

    github.addRepository("acme/api", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start, again" },
    ]);
    clock.advance(5 * minute + 1);
    const pushed: IssueList[] = [];
    core.on("listChanged", (list) => pushed.push(list));
    const reread = await openUntilLoaded(core, acmeApi);

    // What it had shows at once, while it is read again.
    expect(pushed[0] && outline(pushed[0])).toEqual(["#1 Crash on start"]);
    expect(pushed[0]?.loading).toMatchObject({
      status: "refreshing",
      updatedAt: startTime,
    });
    expect(outline(reread)).toEqual([
      "#2 Dark mode",
      "#1 Crash on start, again",
    ]);
    expect(reread.loading).toMatchObject({
      status: "current",
      updatedAt: startTime + 5 * minute + 1,
      openIssues: 2,
    });
  });

  it("shows a list opened again within five minutes of being read without asking GitHub", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openUntilLoaded(core, acmeApi);
    const requestsBefore = github.requestsReceived;

    clock.advance(5 * minute);
    const reopened = await openUntilLoaded(core, acmeApi);

    expect(reopened.loading).toMatchObject({
      status: "current",
      updatedAt: startTime,
    });
    expect(github.requestsReceived).toBe(requestsBefore);
  });

  it("reads the list on screen again when the window regains focus more than five minutes after it was read", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openUntilLoaded(core, acmeApi);
    const requestsBefore = github.requestsReceived;

    github.addRepository("acme/api", [{ number: 1, title: "Crash at start" }]);
    clock.advance(5 * minute);
    await core.revalidate({ kind: "list", scope: acmeApi });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(github.requestsReceived).toBe(requestsBefore);

    clock.advance(1);
    const reread = await untilSettled(core, acmeApi, () =>
      core.revalidate({ kind: "list", scope: acmeApi }),
    );
    expect(outline(reread)).toEqual(["#1 Crash at start"]);
    expect(reread.loading).toMatchObject({
      status: "current",
      updatedAt: startTime + 5 * minute + 1,
    });
  });
});

describe("loading states", () => {
  it("shows at once what another list read when a list opens for the first time, reading it again if it is older than five minutes", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openUntilLoaded(core, all);

    github.addRepository("acme/api", [{ number: 1, title: "Crash at start" }]);
    clock.advance(6 * minute);
    github.pause();
    const shown = new Promise<IssueList>((resolve) => {
      core.on("listChanged", (list) => {
        if (list.scope.kind === "repository" && list.trees.length > 0) {
          resolve(list);
        }
      });
    });
    const reread = openUntilLoaded(core, acmeApi);

    const cached = await shown;
    expect(outline(cached)).toEqual(["#1 Crash on start"]);
    expect(cached.loading).toMatchObject({
      status: "refreshing",
      updatedAt: startTime,
    });
    github.resume();
    expect(outline(await reread)).toEqual(["#1 Crash at start"]);
  });

  it("says a list is empty only once every request for it has succeeded", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Old crash", state: "closed" },
    ]);
    const core = createTestCore(github);
    const pushed: IssueList[] = [];
    core.on("listChanged", (list) => pushed.push(list));
    github.pause();

    const loaded = openUntilLoaded(core, acmeApi);
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });
    expect(pushed.map((list) => list.loading)).toEqual([{ status: "loading" }]);
    github.resume();

    expect((await loaded).loading).toEqual({
      status: "current",
      updatedAt: startTime,
      openIssues: 0,
      closedNotListed: 1,
    });
  });

  it("never asks GitHub anything while time passes on its own", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await readUntilCounted(core);
    await openUntilLoaded(core, acmeApi);
    await openPageUntilLoaded(core, "I_acme/api#1");
    const requestsBefore = github.requestsReceived;

    vi.useFakeTimers();
    try {
      clock.advance(24 * 60 * minute);
      await vi.advanceTimersByTimeAsync(24 * 60 * minute);
    } finally {
      vi.useRealTimers();
    }

    expect(github.requestsReceived).toBe(requestsBefore);
  });

  it("says how far each of All's repositories has loaded", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openUntilLoaded(core, acmeApi);
    clock.advance(minute);
    github.pause("fetchOpenIssues");

    const loading = new Promise<IssueList>((resolve) => {
      core.on("listChanged", (list) => {
        if (list.scope.kind === "all" && list.repositories.length > 0) {
          resolve(list);
        }
      });
    });
    const loaded = openUntilLoaded(core, all);
    expect(await loading).toMatchObject({
      loading: { status: "loading" },
      repositories: [
        {
          repository: { owner: "acme", name: "api" },
          loading: { status: "current", updatedAt: startTime },
        },
        {
          repository: { owner: "acme", name: "web" },
          loading: { status: "loading" },
        },
      ],
    });
    github.resume();

    expect((await loaded).repositories).toEqual([
      {
        repository: { owner: "acme", name: "api" },
        loading: { status: "current", updatedAt: startTime },
      },
      {
        repository: { owner: "acme", name: "web" },
        loading: { status: "current", updatedAt: startTime + minute },
      },
    ]);
  });
});

describe("refresh", () => {
  /** acme/api, tracked, with a closed sub-issue and an external one. */
  async function billing(github: FakeGitHub, version = "") {
    github.addRepository("acme/api", [
      {
        number: 2,
        title: `Launch billing${version}`,
        subIssues: ["acme/api#1", "other/lib#1"],
      },
      { number: 1, title: `Meter requests${version}`, state: "closed" },
    ]);
    github.addRepository("other/lib", [
      { number: 1, title: `Shared client${version}` },
    ]);
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
  }

  it("reads everything a list shows again at once, however recently it was read", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    await billing(github);
    const core = createTestCore(github);
    await openUntilLoaded(core, acmeApi);

    await billing(github, " v2");
    const refreshed = await untilSettled(core, acmeApi, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );

    expect(outline(refreshed)).toEqual([
      "#2 Launch billing v2",
      "  #1 Meter requests v2 · closed",
      "  other/lib#1 Shared client v2 · external",
    ]);
    expect(refreshed.loading).toMatchObject({
      status: "current",
      updatedAt: startTime,
    });
  });

  it("reads the sub-issues of a collapsed issue again only once they show", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    await billing(github);
    const core = createTestCore(github);
    await openUntilLoaded(core, acmeApi);
    await core.setExpanded(acmeApi, "I_acme/api#2", false);

    await billing(github, " v2");
    const refreshed = await untilSettled(core, acmeApi, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );
    expect(outline(refreshed)).toEqual([
      "#2 Launch billing v2",
      "  #1 Meter requests · closed",
      "  other/lib#1 Shared client · external",
    ]);
    expect(collapsedIssues(refreshed)).toEqual(["#2"]);
    expect(github.requestsFor("other/lib")).toBe(1);

    const expanded = await untilSettled(core, acmeApi, () =>
      core.setExpanded(acmeApi, "I_acme/api#2", true),
    );
    expect(outline(expanded)).toEqual([
      "#2 Launch billing v2",
      "  #1 Meter requests v2 · closed",
      "  other/lib#1 Shared client v2 · external",
    ]);
  });

  it("keeps showing every issue while it reads a list's pages again", async () => {
    const github = createFakeGitHub({ login: "octo-reader", issuesPerPage: 1 });
    github.addRepository("acme/api", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    const core = createTestCore(github);
    await openUntilLoaded(core, acmeApi);
    const pushed: IssueList[] = [];
    core.on("listChanged", (list) => pushed.push(list));

    github.addRepository("acme/api", [
      { number: 3, title: "Audit trail" },
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    const refreshed = await untilSettled(core, acmeApi, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );

    for (const list of pushed) {
      expect(outline(list)).toEqual(
        expect.arrayContaining(["#2 Dark mode", "#1 Crash on start"]),
      );
    }
    expect(pushed.slice(0, -1).map((list) => list.loading.status)).toEqual(
      pushed.slice(0, -1).map(() => "refreshing"),
    );
    expect(outline(refreshed)).toEqual([
      "#3 Audit trail",
      "#2 Dark mode",
      "#1 Crash on start",
    ]);
  });

  it("leaves out an issue closed meanwhile once its repository has been read again", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    const core = createTestCore(github);
    await openUntilLoaded(core, acmeApi);

    github.addRepository("acme/api", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start", state: "closed" },
    ]);
    const refreshed = await untilSettled(core, acmeApi, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );

    expect(outline(refreshed)).toEqual(["#2 Dark mode"]);
    expect(refreshed.loading).toMatchObject({
      openIssues: 1,
      closedNotListed: 1,
    });
  });

  it("shows an issue read again for one list in every other list that shows it", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.addRepository("acme/web", [
      { number: 1, title: "Broken footer", subIssues: ["acme/api#1"] },
    ]);
    const core = createTestCore(github);
    await openUntilLoaded(core, acmeApi);
    await openUntilLoaded(core, all);

    github.addRepository("acme/api", [{ number: 1, title: "Crash at start" }]);
    await untilSettled(core, all, () =>
      core.refresh({ kind: "list", scope: all }),
    );
    const requestsBefore = github.requestsReceived;

    expect(outline(await openUntilLoaded(core, acmeApi))).toEqual([
      "#1 Crash at start · ↑ acme/web#1",
    ]);
    expect(github.requestsReceived).toBe(requestsBefore);
  });
});

describe("issue pages", () => {
  it("returns page metadata, including the closing reason and all labels", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    const metadata = {
      stateReason: "not-planned" as const,
      createdAt: "2026-08-01T12:00:00Z",
      author: {
        login: "octo-author",
        avatarUrl: "https://avatars.githubusercontent.com/u/1",
      },
      assignees: [
        {
          login: "octo-dev",
          avatarUrl: "https://avatars.githubusercontent.com/u/2",
        },
      ],
      milestone: "MVP",
      commentCount: 12,
    };
    const labels = ["one", "two", "three", "four"].map((name) => ({
      name,
      color: "ff0000",
    }));
    github.addRepository("other/work", [
      {
        number: 1,
        title: "Done",
        state: "closed",
        labels,
        metadata,
        blockedBy: { open: 2, total: 3 },
        blocking: { open: 1, total: 4 },
      },
    ]);
    const core = createTestCore(github);

    const page = await openPageUntilLoaded(core, "I_other/work#1");

    expect(page.issue).toMatchObject({
      ...metadata,
      state: "closed",
      labels,
      blockedBy: { open: 2, total: 3 },
      blocking: { open: 1, total: 4 },
    });
  });

  it("loads an external issue's ancestry and nested sub-issues without tracking repositories", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }],
      views: [],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("other/work", [
      { number: 2, title: "Parent", subIssues: ["other/work#3"] },
      { number: 3, title: "Page", subIssues: ["other/work#4", "acme/api#6"] },
      { number: 4, title: "Sub-issue", subIssues: ["other/work#5"] },
      { number: 5, title: "Nested", state: "closed" },
    ]);
    github.addRepository("acme/api", [
      { number: 1, title: "Root", subIssues: ["other/work#2"] },
      { number: 6, title: "Second sub-issue" },
    ]);
    const core = createTestCore(github);

    const page = await openPageUntilLoaded(core, "I_other/work#3");

    expect(page.loading).toEqual({ status: "current", updatedAt: startTime });
    expect(page.issue).toMatchObject({ id: "I_other/work#3", external: true });
    expect(page.ancestry.map(({ reference }) => reference)).toEqual([
      "acme/api#1",
      "other/work#2",
    ]);
    expect(page.subIssues.map(({ issue }) => issue.reference)).toEqual([
      "#4",
      "acme/api#6",
    ]);
    expect(page.subIssues[0]).toMatchObject({
      expanded: false,
      subIssues: [
        { issue: { reference: "#5", state: "closed" }, expanded: false },
      ],
    });
    expect(sidebarLines(await readUntilCounted(core))).toEqual(["acme/api 2"]);
  });

  /** An issue with a parent issue and a sub-issue, all in other/work. */
  function workIssues(github: FakeGitHub, version = "") {
    github.addRepository("other/work", [
      { number: 1, title: `Parent${version}`, subIssues: ["other/work#2"] },
      { number: 2, title: `Page${version}`, subIssues: ["other/work#3"] },
      { number: 3, title: `Sub-issue${version}` },
    ]);
  }

  /** A page as a user reads it: its ancestry, title and sub-issues. */
  function pageOutline(page: IssuePage): string[] {
    return [
      ...page.ancestry.map(({ title }) => `/ ${title}`),
      `# ${page.issue?.title ?? "?"}`,
      ...page.subIssues.map(({ issue }) => `- ${issue.title}`),
    ];
  }

  it("shows a page opened again at once, and reads it again in the background when it is older than five minutes", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    workIssues(github);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openPageUntilLoaded(core, "I_other/work#2");

    workIssues(github, " v2");
    clock.advance(5 * minute);
    const requestsBefore = github.requestsReceived;
    const recent = await openPageUntilLoaded(core, "I_other/work#2");
    expect(pageOutline(recent)).toEqual(["/ Parent", "# Page", "- Sub-issue"]);
    expect(github.requestsReceived).toBe(requestsBefore);

    clock.advance(1);
    const pushed: IssuePage[] = [];
    core.on("issuePageChanged", (page) => pushed.push(page));
    const reread = await openPageUntilLoaded(core, "I_other/work#2");

    expect(pushed[0] && pageOutline(pushed[0])).toEqual([
      "/ Parent",
      "# Page",
      "- Sub-issue",
    ]);
    expect(pushed[0]?.loading).toEqual({
      status: "refreshing",
      updatedAt: startTime,
    });
    expect(pageOutline(reread)).toEqual([
      "/ Parent v2",
      "# Page v2",
      "- Sub-issue v2",
    ]);
    expect(reread.loading).toEqual({
      status: "current",
      updatedAt: startTime + 5 * minute + 1,
    });
  });

  it("reads a page on screen again when the window regains focus more than five minutes after it was read", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    workIssues(github);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openPageUntilLoaded(core, "I_other/work#2");

    workIssues(github, " v2");
    clock.advance(5 * minute + 1);
    const reread = await pageUntilSettled(core, "I_other/work#2", () =>
      core.revalidate({ kind: "issue", issueId: "I_other/work#2" }),
    );

    expect(pageOutline(reread)).toEqual([
      "/ Parent v2",
      "# Page v2",
      "- Sub-issue v2",
    ]);
  });

  it("reads a page's metadata, ancestry and sub-issues again on a refresh, however recently they were read", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    workIssues(github);
    const core = createTestCore(github);
    await openPageUntilLoaded(core, "I_other/work#2");

    workIssues(github, " v2");
    const refreshed = await pageUntilSettled(core, "I_other/work#2", () =>
      core.refresh({ kind: "issue", issueId: "I_other/work#2" }),
    );

    expect(pageOutline(refreshed)).toEqual([
      "/ Parent v2",
      "# Page v2",
      "- Sub-issue v2",
    ]);
    expect(refreshed.loading).toEqual({
      status: "current",
      updatedAt: startTime,
    });
  });

  it("reads a page again on a refresh while it is being read", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Launch billing", subIssues: ["acme/api#2"] },
      { number: 2, title: "Meter requests", state: "closed" },
    ]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openUntilLoaded(core, acmeApi);

    github.addRepository("acme/api", [
      { number: 1, title: "Launch billing", subIssues: ["acme/api#2"] },
      { number: 2, title: "Meter usage", state: "closed" },
    ]);
    clock.advance(4 * minute);
    github.pause("fetchIssueDetails");
    const refreshed = pageUntilSettled(core, "I_acme/api#1", async () => {
      await core.openIssuePage("I_acme/api#1");
      await vi.waitFor(() => {
        expect(github.requestsInFlight).toBe(1);
      });
      await core.refresh({ kind: "issue", issueId: "I_acme/api#1" });
      github.resume();
    });

    expect((await refreshed).subIssues.map(({ issue }) => issue.title)).toEqual(
      ["Meter usage"],
    );
  });

  it("shows a page's issue as soon as it has arrived, with its relationships marked loading until they have", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    workIssues(github);
    const core = createTestCore(github);
    github.pause("fetchIssues");
    const pushed: IssuePage[] = [];
    core.on("issuePageChanged", (page) => pushed.push(page));

    const loaded = openPageUntilLoaded(core, "I_other/work#2");
    await vi.waitFor(() => {
      expect(pushed.some((page) => page.issue !== undefined)).toBe(true);
    });
    const early = pushed.find((page) => page.issue !== undefined);
    expect(early && pageOutline(early)).toEqual([
      "/ Parent",
      "# Page",
      "- Sub-issue",
    ]);
    expect(early?.ancestry[0]?.unread).toEqual({ status: "loading" });
    expect(early?.subIssues[0]?.unread).toEqual({ status: "loading" });
    expect(early?.loading).toEqual({ status: "loading" });
    github.resume();

    expect((await loaded).loading.status).toBe("current");
  });

  it("shows an issue read again for a list on its page", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);
    await openUntilLoaded(core, acmeApi);
    await openPageUntilLoaded(core, "I_acme/api#1");

    github.addRepository("acme/api", [{ number: 1, title: "Crash at start" }]);
    await untilSettled(core, acmeApi, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );
    const requestsBefore = github.requestsReceived;

    const page = await openPageUntilLoaded(core, "I_acme/api#1");
    expect(page.issue?.title).toBe("Crash at start");
    expect(github.requestsReceived).toBe(requestsBefore);
  });
});

it("reports an inaccessible issue without presenting it as an empty page", async () => {
  const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));
  const page = await openPageUntilLoaded(core, "I_other/work#404");
  expect(page.issue).toBeUndefined();
  expect(page.loading.status).toBe("failed");
});

/** gh failing to reach GitHub, as it does without a connection. */
const cannotReachGitHub: GitHubError = {
  kind: "gh-failed",
  message:
    'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host',
};

describe("stale content", () => {
  it("keeps a list's issues when reading it again cannot reach GitHub, marked stale as of when they were read", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openUntilLoaded(core, acmeApi);

    clock.advance(2 * minute);
    github.failWith(cannotReachGitHub);
    const stale = await untilSettled(core, acmeApi, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );

    expect(outline(stale)).toEqual(["#1 Crash on start"]);
    expect(stale.loading).toEqual({
      status: "stale",
      updatedAt: startTime,
      problem: { kind: "unreachable", message: cannotReachGitHub.message },
      openIssues: 1,
      closedNotListed: 0,
    });
  });

  it("keeps All's issues when reading its repositories again cannot reach GitHub, each marked stale", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openUntilLoaded(core, all);

    clock.advance(6 * minute);
    github.failWith(cannotReachGitHub);
    const stale = await untilSettled(core, all, () =>
      core.revalidate({ kind: "list", scope: all }),
    );

    expect(outline(stale)).toEqual([
      "acme/api #1 Crash on start",
      "acme/web #1 Broken footer",
    ]);
    const problem = { kind: "unreachable", message: cannotReachGitHub.message };
    expect(stale.loading).toMatchObject({
      status: "stale",
      updatedAt: startTime,
      problem,
    });
    expect(stale.repositories.map(({ loading }) => loading)).toEqual([
      { status: "stale", updatedAt: startTime, problem },
      { status: "stale", updatedAt: startTime, problem },
    ]);
  });

  it("keeps an issue page when reading it again cannot reach GitHub, marked stale", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("other/work", [
      { number: 1, title: "Parent", subIssues: ["other/work#2"] },
      { number: 2, title: "Page", subIssues: ["other/work#3"] },
      { number: 3, title: "Sub-issue" },
    ]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    const loaded = await openPageUntilLoaded(core, "I_other/work#2");

    clock.advance(minute);
    github.failWith(cannotReachGitHub);
    const stale = await pageUntilSettled(core, "I_other/work#2", () =>
      core.refresh({ kind: "issue", issueId: "I_other/work#2" }),
    );

    const problem = {
      kind: "unreachable",
      message: cannotReachGitHub.message,
    } as const;
    expect(stale).toEqual({
      ...loaded,
      comments: {
        comments: [],
        loading: { status: "stale", updatedAt: startTime, problem },
      },
      loading: { status: "stale", updatedAt: startTime, problem },
    });
  });
});

describe("failed content", () => {
  it("says why a list could not be read when nothing was read before, never as empty", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.failWith(cannotReachGitHub);
    const core = createTestCore(github);

    expect(await openUntilLoaded(core, acmeApi)).toEqual({
      scope: acmeApi,
      trees: [],
      repositories: [],
      loading: {
        status: "failed",
        problem: { kind: "unreachable", message: cannotReachGitHub.message },
      },
    });
  });

  it("keeps the pages that loaded before a later one failed, as failed", async () => {
    const github = createFakeGitHub({ login: "octo-reader", issuesPerPage: 1 });
    github.addRepository("acme/api", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    const core = createTestCore(github);
    github.pause("fetchOpenIssues");
    const loaded = openUntilLoaded(core, acmeApi);
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });

    github.failNextWith(cannotReachGitHub);
    github.resume();
    const list = await loaded;

    expect(outline(list)).toEqual(["#2 Dark mode"]);
    expect(list.loading).toEqual({
      status: "failed",
      problem: { kind: "unreachable", message: cannotReachGitHub.message },
    });
  });

  it("marks an open sub-issue failed, not loading, when the page it would come with failed", async () => {
    const github = createFakeGitHub({ login: "octo-reader", issuesPerPage: 1 });
    github.addRepository("acme/api", [
      { number: 2, title: "Launch billing", subIssues: ["acme/api#1"] },
      { number: 1, title: "Meter requests" },
    ]);
    const core = createTestCore(github);
    github.pause("fetchOpenIssues");
    const loaded = openUntilLoaded(core, acmeApi);
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });

    github.failNextWith(cannotReachGitHub);
    github.resume();
    const list = await loaded;

    expect(outline(list)).toEqual(["#2 Launch billing", "  #1 Meter requests"]);
    expect(list.trees[0]?.subIssues[0]?.unread).toEqual({
      status: "failed",
      problem: { kind: "unreachable", message: cannotReachGitHub.message },
    });
  });

  it("says why an issue page could not be read when nothing was read before", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("other/work", [{ number: 1, title: "Page" }]);
    github.failWith(cannotReachGitHub);
    const core = createTestCore(github);

    expect(await openPageUntilLoaded(core, "I_other/work#1")).toEqual({
      issueId: "I_other/work#1",
      issue: undefined,
      ancestry: [],
      subIssues: [],
      loading: {
        status: "failed",
        problem: { kind: "unreachable", message: cannotReachGitHub.message },
      },
    });
  });
});

describe("unavailable content", () => {
  const unavailable = { kind: "unavailable", access: undefined } as const;

  it("replaces a repository's list once GitHub no longer shows the repository, never saying why it cannot know", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);
    await openUntilLoaded(core, acmeApi);

    github.hide("acme/api");
    const list = await untilSettled(core, acmeApi, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );

    expect(list.trees).toEqual([]);
    expect(list.loading).toEqual({ status: "failed", problem: unavailable });
  });

  it("names SSO, with GitHub's link to authorize, only when GitHub's answer does", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const sso = {
      kind: "sso",
      message:
        "Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.",
      url: "https://github.com/orgs/acme/sso?authorization_request=A1B2C3",
    } as const;
    github.hide("acme/api", sso);
    const core = createTestCore(github);

    expect((await openUntilLoaded(core, acmeApi)).loading).toEqual({
      status: "failed",
      problem: { kind: "unavailable", access: sso },
    });
  });

  it("takes a repository GitHub no longer shows out of All, keeping the others", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.addRepository("acme/web", [{ number: 1, title: "Broken footer" }]);
    const core = createTestCore(github);
    await openUntilLoaded(core, all);

    github.hide("acme/web");
    const list = await untilSettled(core, all, () =>
      core.refresh({ kind: "list", scope: all }),
    );

    expect(outline(list)).toEqual(["acme/api #1 Crash on start"]);
    expect(list.loading).toMatchObject({ status: "current", openIssues: 1 });
    expect(list.repositories.map(({ loading }) => loading)).toEqual([
      { status: "current", updatedAt: startTime },
      { status: "failed", problem: unavailable },
    ]);
  });

  it("replaces an issue page once GitHub no longer shows the issue", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("other/work", [
      { number: 1, title: "Parent", subIssues: ["other/work#2"] },
      { number: 2, title: "Page", subIssues: ["other/work#3"] },
      { number: 3, title: "Sub-issue" },
    ]);
    const core = createTestCore(github);
    await openPageUntilLoaded(core, "I_other/work#2");

    github.hide("other/work#2");
    const page = await pageUntilSettled(core, "I_other/work#2", () =>
      core.refresh({ kind: "issue", issueId: "I_other/work#2" }),
    );

    expect(page).toEqual({
      issueId: "I_other/work#2",
      issue: undefined,
      ancestry: [],
      subIssues: [],
      loading: { status: "failed", problem: unavailable },
    });
  });

  it("stops showing an issue GitHub no longer shows wherever it appeared, as unavailable where a relationship names it", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Launch billing", subIssues: ["other/lib#1"] },
    ]);
    github.addRepository("other/lib", [{ number: 1, title: "Shared client" }]);
    const core = createTestCore(github);
    await openUntilLoaded(core, acmeApi);
    await openPageUntilLoaded(core, "I_other/lib#1");

    github.hide("other/lib#1");
    await pageUntilSettled(core, "I_other/lib#1", () =>
      core.refresh({ kind: "issue", issueId: "I_other/lib#1" }),
    );
    const list = await openUntilLoaded(core, acmeApi);

    expect(outline(list)).toEqual([
      "#1 Launch billing",
      "  other/lib#1 Shared client · external",
    ]);
    expect(list.trees[0]?.subIssues[0]).toEqual({
      issue: {
        id: "I_other/lib#1",
        repository: { owner: "other", name: "lib" },
        reference: "other/lib#1",
        title: "Shared client",
        state: "open",
        url: "https://github.com/other/lib/issues/1",
        external: true,
      },
      subIssues: [],
      expanded: false,
      unread: { status: "failed", problem: unavailable },
    });
  });
});

describe("partial content", () => {
  /**
   * Opens acme/api's list, whose open issue #3 has closed sub-issues #1 and
   * #2, and lets `meanwhile` change GitHub once the list's page has been
   * answered, before the sub-issues are asked for.
   */
  async function openWithSubIssues(meanwhile: (github: FakeGitHub) => void) {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      {
        number: 3,
        title: "Launch billing",
        subIssues: ["acme/api#1", "acme/api#2"],
      },
      { number: 2, title: "Meter requests", state: "closed" },
      { number: 1, title: "Send invoices", state: "closed" },
    ]);
    const core = createTestCore(github);
    github.pause("fetchOpenIssues");
    const loaded = openUntilLoaded(core, acmeApi);
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });
    meanwhile(github);
    github.resume();
    return { core, github, list: await loaded };
  }

  it("keeps the open issues GitHub answers when it leaves others out of a page, reading the pages after it, and marks the list incomplete", async () => {
    const github = createFakeGitHub({ login: "octo-reader", issuesPerPage: 1 });
    github.addRepository("acme/api", [
      { number: 3, title: "Dark mode" },
      { number: 2, title: "Hidden work" },
      { number: 1, title: "Crash on start" },
    ]);
    github.hide("acme/api#2");
    const core = createTestCore(github);

    const list = await openUntilLoaded(core, acmeApi);

    expect(outline(list)).toEqual(["#3 Dark mode", "#1 Crash on start"]);
    expect(list.loading).toEqual({
      status: "stale",
      updatedAt: startTime,
      problem: {
        kind: "error",
        message:
          "GitHub left out some open issues: Unavailable or not accessible with this account: Could not resolve to a node with the global id of 'I_acme/api#2'.",
      },
      openIssues: 2,
      closedNotListed: 0,
    });
  });

  it("replaces what was read before once GitHub leaves an open issue out, rather than showing it from before", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 2, title: "Hidden work" },
      { number: 1, title: "Crash on start" },
    ]);
    const core = createTestCore(github);
    await openUntilLoaded(core, acmeApi);

    github.hide("acme/api#2");
    const list = await untilSettled(core, acmeApi, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );

    expect(outline(list)).toEqual(["#1 Crash on start"]);
    expect(list.loading.status).toBe("stale");
  });

  it("marks sub-issues that could not be read in their place, with what their parent issue names, and keeps the rest", async () => {
    const { list } = await openWithSubIssues((github) => {
      github.failWith(cannotReachGitHub);
    });

    expect(outline(list)).toEqual([
      "#3 Launch billing",
      "  #1 Send invoices · closed",
      "  #2 Meter requests · closed",
    ]);
    const problem = { kind: "unreachable", message: cannotReachGitHub.message };
    expect(list.trees[0]?.subIssues.map((node) => node.unread)).toEqual([
      { status: "failed", problem },
      { status: "failed", problem },
    ]);
    expect(list.trees[0]?.subIssues[0]?.issue).toEqual({
      id: "I_acme/api#1",
      repository: { owner: "acme", name: "api" },
      reference: "#1",
      title: "Send invoices",
      state: "closed",
      url: "https://github.com/acme/api/issues/1",
      external: false,
    });
    expect(list.loading).toMatchObject({ status: "current", openIssues: 1 });
  });

  it("keeps the issues GitHub answers when it will not show another asked for with them", async () => {
    const { list } = await openWithSubIssues((github) => {
      github.hide("acme/api#2");
    });

    expect(list.trees[0]?.subIssues.map((node) => node.unread)).toEqual([
      undefined,
      {
        status: "failed",
        problem: { kind: "unavailable", access: undefined },
      },
    ]);
  });

  it("keeps an issue GitHub answers only in part, marked incomplete with why", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      {
        number: 1,
        title: "Launch billing",
        subIssues: ["acme/api#2", "secret/sdk#1"],
      },
      { number: 2, title: "Meter requests" },
    ]);
    github.addRepository("secret/sdk", [{ number: 1, title: "Retry in SDK" }]);
    const sso = {
      kind: "sso",
      message:
        "Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.",
      url: undefined,
    } as const;
    github.hide("secret/sdk", sso);
    const core = createTestCore(github);

    const list = await openUntilLoaded(core, acmeApi);

    expect(outline(list)).toEqual(["#1 Launch billing", "  #2 Meter requests"]);
    const tree = readSummary(list.trees[0]);
    expect(tree.incomplete).toEqual({ kind: "unavailable", access: sso });
    expect(tree.subIssueProgress).toEqual({ closed: 0, total: 2 });
  });

  it("marks an issue page's parts that could not be read in their place, keeping the rest", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("other/work", [
      { number: 1, title: "Parent", subIssues: ["other/work#2"] },
      { number: 2, title: "Page", subIssues: ["other/work#3"] },
      { number: 3, title: "Sub-issue" },
    ]);
    const core = createTestCore(github);
    github.pause("fetchIssueDetails");
    const loaded = openPageUntilLoaded(core, "I_other/work#2");
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });
    github.failWith(cannotReachGitHub);
    github.resume();
    const page = await loaded;

    const failed = {
      status: "failed",
      problem: { kind: "unreachable", message: cannotReachGitHub.message },
    };
    expect(page.issue?.title).toBe("Page");
    expect(page.ancestry).toEqual([
      {
        id: "I_other/work#1",
        url: "https://github.com/other/work/issues/1",
        reference: "other/work#1",
        title: "Parent",
        external: true,
        unread: failed,
      },
    ]);
    expect(page.subIssues).toEqual([
      {
        issue: {
          id: "I_other/work#3",
          repository: { owner: "other", name: "work" },
          reference: "#3",
          title: "Sub-issue",
          state: "open",
          url: "https://github.com/other/work/issues/3",
          external: true,
        },
        subIssues: [],
        expanded: false,
        parent: undefined,
        unread: failed,
      },
    ]);
    expect(page.loading).toEqual({ status: "current", updatedAt: startTime });
  });

  it.each<[string, (core: Contract) => Promise<void>]>([
    ["on Retry", (core) => core.retry({ kind: "list", scope: acmeApi })],
    [
      "as the window regains focus",
      (core) => core.revalidate({ kind: "list", scope: acmeApi }),
    ],
    ["as the list is opened again", (core) => core.openList(acmeApi)],
  ])(
    "reads the parts of a list that failed again %s, however recently they failed",
    async (_, act) => {
      const { core, github } = await openWithSubIssues((github) => {
        github.failWith(cannotReachGitHub);
      });

      github.failWith(undefined);
      const list = await untilSettled(core, acmeApi, () => act(core));

      expect(list.trees[0]?.subIssues.map((node) => node.unread)).toEqual([
        undefined,
        undefined,
      ]);
    },
  );

  it("reads an issue GitHub answered only in part again as the window regains focus", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Launch billing", subIssues: ["secret/sdk#1"] },
    ]);
    github.addRepository("secret/sdk", [{ number: 1, title: "Retry in SDK" }]);
    github.hide("secret/sdk");
    const core = createTestCore(github);
    await openUntilLoaded(core, acmeApi);

    // Access granted meanwhile, e.g. SSO authorized in the browser.
    github.reveal("secret/sdk");
    const list = await untilSettled(core, acmeApi, () =>
      core.revalidate({ kind: "list", scope: acmeApi }),
    );

    expect(outline(list)).toEqual([
      "#1 Launch billing",
      "  secret/sdk#1 Retry in SDK · external",
    ]);
    expect(readSummary(list.trees[0]).incomplete).toBeUndefined();
  });

  it("reads an issue GitHub answered only in part again on Retry, also below a collapsed issue", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 2, title: "Launch billing", subIssues: ["acme/api#1"] },
      { number: 1, title: "Meter requests", subIssues: ["secret/sdk#1"] },
    ]);
    github.addRepository("secret/sdk", [{ number: 1, title: "Retry in SDK" }]);
    github.hide("secret/sdk");
    const core = createTestCore(github);
    await openUntilLoaded(core, acmeApi);
    await core.setExpanded(acmeApi, "I_acme/api#2", false);

    github.reveal("secret/sdk");
    await untilSettled(core, acmeApi, () =>
      core.retry({ kind: "list", scope: acmeApi }),
    );
    const expanded = await nextList(core, acmeApi, () =>
      core.setExpanded(acmeApi, "I_acme/api#2", true),
    );

    expect(outline(expanded)).toEqual([
      "#2 Launch billing",
      "  #1 Meter requests",
      "    secret/sdk#1 Retry in SDK · external",
    ]);
  });

  it("reads the parts of an issue page that failed again as it is shown again, however recently they failed", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("other/work", [
      { number: 1, title: "Parent", subIssues: ["other/work#2"] },
      { number: 2, title: "Page", subIssues: ["other/work#3"] },
      { number: 3, title: "Sub-issue" },
    ]);
    const core = createTestCore(github);
    github.pause("fetchIssueDetails");
    const loaded = openPageUntilLoaded(core, "I_other/work#2");
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });
    github.failWith(cannotReachGitHub);
    github.resume();
    await loaded;

    github.failWith(undefined);
    const page = await pageUntilSettled(core, "I_other/work#2", () =>
      core.revalidate({ kind: "issue", issueId: "I_other/work#2" }),
    );

    expect(page.ancestry.map(({ unread }) => unread)).toEqual([undefined]);
    expect(page.subIssues.map(({ unread }) => unread)).toEqual([undefined]);
    expect(page.loading.status).toBe("current");
  });
});

describe("retrying", () => {
  it("reads a stale list again on Retry, current once it could be read", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openUntilLoaded(core, acmeApi);
    github.failWith(cannotReachGitHub);
    await untilSettled(core, acmeApi, () =>
      core.refresh({ kind: "list", scope: acmeApi }),
    );

    clock.advance(minute);
    github.failWith(undefined);
    github.addRepository("acme/api", [{ number: 1, title: "Crash at start" }]);
    const list = await untilSettled(core, acmeApi, () =>
      core.retry({ kind: "list", scope: acmeApi }),
    );

    expect(outline(list)).toEqual(["#1 Crash at start"]);
    expect(list.loading).toMatchObject({
      status: "current",
      updatedAt: startTime + minute,
    });
  });

  it("reads a repository GitHub would not show again on Retry, e.g. once SSO is authorized", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.hide("acme/api");
    const core = createTestCore(github);
    await openUntilLoaded(core, acmeApi);

    github.reveal("acme/api");
    const list = await untilSettled(core, acmeApi, () =>
      core.retry({ kind: "list", scope: acmeApi }),
    );

    expect(outline(list)).toEqual(["#1 Crash on start"]);
    expect(list.loading.status).toBe("current");
  });

  it("reads an issue page GitHub would not show again as it is opened again", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("other/work", [{ number: 1, title: "Page" }]);
    github.hide("other/work#1");
    const core = createTestCore(github);
    await openPageUntilLoaded(core, "I_other/work#1");

    github.reveal("other/work#1");
    const page = await openPageUntilLoaded(core, "I_other/work#1");

    expect(page.issue?.title).toBe("Page");
    expect(page.loading.status).toBe("current");
  });

  it("asks GitHub nothing again on Retry when nothing failed", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const core = createTestCore(github);
    await readUntilCounted(core);
    await openUntilLoaded(core, acmeApi);
    await openPageUntilLoaded(core, "I_acme/api#1");
    const requestsBefore = github.requestsReceived;

    await core.retry({ kind: "list", scope: acmeApi });
    await core.retry({ kind: "issue", issueId: "I_acme/api#1" });

    expect(github.requestsReceived).toBe(requestsBefore);
  });
});

describe("transient failures", () => {
  const serverError: GitHubError = {
    kind: "server-error",
    message: "We couldn't respond to your request in time.",
  };

  it("tries a request GitHub's servers failed again twice on its own, then fails", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.failWith(serverError);
    const core = createTestCore(github);

    const list = await openUntilLoaded(core, acmeApi);

    expect(list.loading).toEqual({
      status: "failed",
      problem: {
        kind: "error",
        message:
          "GitHub failed to answer: We couldn't respond to your request in time.",
      },
    });
    expect(github.requestsFor("acme/api")).toBe(3);
  });

  it("loads once GitHub's servers recover within two tries more", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.failNextWith(serverError, 2);
    const core = createTestCore(github);

    const list = await openUntilLoaded(core, acmeApi);

    expect(outline(list)).toEqual(["#1 Crash on start"]);
    expect(list.loading.status).toBe("current");
    expect(github.requestsFor("acme/api")).toBe(3);
  });

  it("never tries again on its own when GitHub cannot be reached", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.failWith(cannotReachGitHub);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openUntilLoaded(core, acmeApi);

    vi.useFakeTimers();
    try {
      clock.advance(60 * minute);
      await vi.advanceTimersByTimeAsync(60 * minute);
    } finally {
      vi.useRealTimers();
    }

    expect(github.requestsFor("acme/api")).toBe(1);
  });
});

describe("issue bodies and comments", () => {
  it("shows the body as GitHub renders it to HTML", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      {
        number: 1,
        title: "Crash on start",
        metadata: {
          bodyHTML: '<p dir="auto">It crashes <del>often</del>.</p>',
        },
      },
    ]);
    const core = createTestCore(github);

    const page = await openPageUntilLoaded(core, "I_acme/api#1");

    expect(page.issue?.bodyHTML).toBe(
      '<p dir="auto">It crashes <del>often</del>.</p>',
    );
  });

  /** Comments by one author, each saying which it is. */
  function comments(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      author: "octo-dev",
      bodyHTML: `<p dir="auto">Comment ${String(index + 1)}</p>`,
    }));
  }

  it("shows every comment, oldest first, read 100 at a time", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Crash on start", comments: comments(250) },
    ]);
    const core = createTestCore(github);

    const page = await openPageUntilLoaded(core, "I_acme/api#1");

    const shown = page.comments?.comments ?? [];
    expect(shown).toHaveLength(250);
    expect(shown[0]).toEqual({
      id: "IC_acme/api#1/1",
      author: {
        login: "octo-dev",
        avatarUrl: "https://avatars.githubusercontent.com/octo-dev",
      },
      createdAt: "2026-09-01T12:00:00Z",
      url: "https://github.com/acme/api/issues/1#issuecomment-1",
      bodyHTML: '<p dir="auto">Comment 1</p>',
    });
    expect(shown.at(-1)?.bodyHTML).toBe('<p dir="auto">Comment 250</p>');
    expect(page.comments?.loading).toEqual({
      status: "current",
      updatedAt: startTime,
    });
    expect(
      github.received.filter((request) =>
        request.startsWith("fetchIssueComments"),
      ),
    ).toEqual([
      "fetchIssueComments acme/api#1",
      "fetchIssueComments acme/api#1 after 100",
      "fetchIssueComments acme/api#1 after 200",
    ]);
  });

  /**
   * A paragraph with an uploaded image, as GitHub renders it: its link is
   * signed anew in every answer.
   */
  function withImage(text: string, signature: string) {
    const src = `https://private-user-images.githubusercontent.com/1/2-3f2a.png?jwt=${signature}`;
    return `<p dir="auto">${text} <a href="${src}"><img src="${src}" alt="Screenshot"></a></p>`;
  }

  function issueWithImages(text: string, signature: string) {
    return {
      number: 1,
      title: "Crash on start",
      metadata: { bodyHTML: withImage(text, signature) },
      comments: [{ author: "octo-dev", bodyHTML: withImage(text, signature) }],
    };
  }

  it("reads the body and every comment again on a refresh", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [issueWithImages("Before", "a")]);
    const core = createTestCore(github);
    await openPageUntilLoaded(core, "I_acme/api#1");

    github.addRepository("acme/api", [
      {
        ...issueWithImages("After", "b"),
        comments: comments(101),
      },
    ]);
    const refreshed = await pageUntilSettled(core, "I_acme/api#1", () =>
      core.refresh({ kind: "issue", issueId: "I_acme/api#1" }),
    );

    expect(refreshed.issue?.bodyHTML).toBe(withImage("After", "b"));
    expect(refreshed.comments?.comments.map((c) => c.bodyHTML)).toEqual(
      comments(101).map((c) => c.bodyHTML),
    );
  });

  it("keeps a body and comments whose media links GitHub only signed anew, so they do not show again", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [issueWithImages("Crashes", "a")]);
    const core = createTestCore(github);
    await openPageUntilLoaded(core, "I_acme/api#1");

    github.addRepository("acme/api", [issueWithImages("Crashes", "b")]);
    const refreshed = await pageUntilSettled(core, "I_acme/api#1", () =>
      core.refresh({ kind: "issue", issueId: "I_acme/api#1" }),
    );

    expect(refreshed.issue?.bodyHTML).toBe(withImage("Crashes", "a"));
    expect(refreshed.comments?.comments[0]?.bodyHTML).toBe(
      withImage("Crashes", "a"),
    );
  });

  describe("media links", () => {
    it("reads a body again for fresh links once one of its images failed to load, showing it although only its signatures changed", async () => {
      const github = createFakeGitHub({ login: "octo-reader" });
      github.addRepository("acme/api", [issueWithImages("Crashes", "a")]);
      const core = createTestCore(github);
      await openPageUntilLoaded(core, "I_acme/api#1");
      const pushed: IssuePage[] = [];
      core.on("issuePageChanged", (page) => pushed.push(page));

      github.addRepository("acme/api", [issueWithImages("Crashes", "b")]);
      const renewed = await core.renewMediaLinks(
        "I_acme/api#1",
        "I_acme/api#1",
      );

      expect(renewed).toEqual({
        status: "renewed",
        bodyHTML: withImage("Crashes", "b"),
      });
      expect(pushed.at(-1)?.issue?.bodyHTML).toBe(withImage("Crashes", "b"));
    });

    /** acme/api#1, whose body and first two comments show an image. */
    function issueWithThreeImages(signature: string) {
      return {
        ...issueWithImages("Crashes", signature),
        comments: [
          { author: "octo-dev", bodyHTML: withImage("Here", signature) },
          { author: "octo-dev", bodyHTML: withImage("There", signature) },
          { author: "octo-dev", bodyHTML: '<p dir="auto">No image</p>' },
        ],
      };
    }

    it("reads every body with signed links again in one request, however many of their images fail at once", async () => {
      const github = createFakeGitHub({ login: "octo-reader" });
      github.addRepository("acme/api", [issueWithThreeImages("a")]);
      const core = createTestCore(github);
      await openPageUntilLoaded(core, "I_acme/api#1");
      const requestsBefore = github.received.length;

      github.addRepository("acme/api", [issueWithThreeImages("b")]);
      const renewed = await Promise.all(
        ["I_acme/api#1", "IC_acme/api#1/2", "IC_acme/api#1/1"].map((bodyId) =>
          core.renewMediaLinks("I_acme/api#1", bodyId),
        ),
      );

      expect(renewed).toEqual([
        { status: "renewed", bodyHTML: withImage("Crashes", "b") },
        { status: "renewed", bodyHTML: withImage("There", "b") },
        { status: "renewed", bodyHTML: withImage("Here", "b") },
      ]);
      expect(github.received.slice(requestsBefore)).toEqual([
        "fetchBodyHtml acme/api#1 acme/api#1/1 acme/api#1/2",
      ]);
    });

    it("answers for a body read again less than a minute ago as it was read, and reads it again after", async () => {
      const github = createFakeGitHub({ login: "octo-reader" });
      github.addRepository("acme/api", [issueWithThreeImages("a")]);
      const clock = createClock();
      const core = createTestCore(github, { clock });
      await openPageUntilLoaded(core, "I_acme/api#1");
      github.addRepository("acme/api", [issueWithThreeImages("b")]);
      await core.renewMediaLinks("I_acme/api#1", "I_acme/api#1");
      const requestsBefore = github.received.length;

      github.addRepository("acme/api", [issueWithThreeImages("c")]);
      clock.advance(minute - 1);
      expect(
        await core.renewMediaLinks("I_acme/api#1", "IC_acme/api#1/1"),
      ).toEqual({ status: "renewed", bodyHTML: withImage("Here", "b") });
      expect(github.received.length).toBe(requestsBefore);

      clock.advance(1);
      expect(
        await core.renewMediaLinks("I_acme/api#1", "IC_acme/api#1/1"),
      ).toEqual({ status: "renewed", bodyHTML: withImage("Here", "c") });
      expect(github.received.slice(requestsBefore)).toEqual([
        "fetchBodyHtml acme/api#1 acme/api#1/1 acme/api#1/2",
      ]);
    });

    it("says why a body could not be read again, showing it as it was, and reads it when asked again", async () => {
      const github = createFakeGitHub({ login: "octo-reader" });
      github.addRepository("acme/api", [issueWithImages("Crashes", "a")]);
      const core = createTestCore(github);
      const page = await openPageUntilLoaded(core, "I_acme/api#1");
      const pushed: IssuePage[] = [];
      core.on("issuePageChanged", (changed) => pushed.push(changed));

      github.addRepository("acme/api", [issueWithImages("Crashes", "b")]);
      github.failNextWith(cannotReachGitHub);
      expect(
        await core.renewMediaLinks("I_acme/api#1", "I_acme/api#1"),
      ).toEqual({
        status: "failed",
        problem: { kind: "unreachable", message: cannotReachGitHub.message },
      });
      expect(pushed.at(-1)?.issue?.bodyHTML ?? page.issue?.bodyHTML).toBe(
        withImage("Crashes", "a"),
      );

      expect(
        await core.renewMediaLinks("I_acme/api#1", "I_acme/api#1"),
      ).toEqual({ status: "renewed", bodyHTML: withImage("Crashes", "b") });
    });

    it("says a comment GitHub no longer shows could not be read again", async () => {
      const github = createFakeGitHub({ login: "octo-reader" });
      github.addRepository("acme/api", [issueWithImages("Crashes", "a")]);
      const core = createTestCore(github);
      await openPageUntilLoaded(core, "I_acme/api#1");

      github.addRepository("acme/api", [
        { ...issueWithImages("Crashes", "b"), comments: [] },
      ]);
      expect(
        await core.renewMediaLinks("I_acme/api#1", "IC_acme/api#1/1"),
      ).toEqual({
        status: "failed",
        problem: { kind: "unavailable", access: undefined },
      });
    });

    it("reads nothing again for a page no longer on screen", async () => {
      const github = createFakeGitHub({ login: "octo-reader" });
      github.addRepository("acme/api", [
        issueWithImages("Crashes", "a"),
        { number: 2, title: "Dark mode" },
      ]);
      const core = createTestCore(github);
      await openPageUntilLoaded(core, "I_acme/api#1");
      await openPageUntilLoaded(core, "I_acme/api#2");
      const requestsBefore = github.received.length;

      expect(
        await core.renewMediaLinks("I_acme/api#1", "I_acme/api#1"),
      ).toEqual({ status: "failed", problem: { kind: "interrupted" } });
      expect(github.received.length).toBe(requestsBefore);
    });

    it("answers for a body without signed links as it is, asking GitHub nothing", async () => {
      const github = createFakeGitHub({ login: "octo-reader" });
      github.addRepository("acme/api", [issueWithThreeImages("a")]);
      const core = createTestCore(github);
      await openPageUntilLoaded(core, "I_acme/api#1");
      const requestsBefore = github.received.length;

      expect(
        await core.renewMediaLinks("I_acme/api#1", "IC_acme/api#1/3"),
      ).toEqual({ status: "renewed", bodyHTML: '<p dir="auto">No image</p>' });
      expect(github.received.length).toBe(requestsBefore);
    });
  });

  it("shows the comments that could be read when the rest could not, and reads them all on Retry", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Crash on start", comments: comments(250) },
    ]);
    const core = createTestCore(github);
    github.pause("fetchIssueComments");
    const loaded = openPageUntilLoaded(core, "I_acme/api#1");
    await vi.waitFor(() => {
      expect(github.received).toContain("fetchIssueComments acme/api#1");
    });
    github.failWith(cannotReachGitHub);
    github.resume();
    const partial = await loaded;

    expect(partial.comments?.comments).toHaveLength(100);
    expect(partial.comments?.loading).toEqual({
      status: "partial",
      updatedAt: startTime,
      problem: { kind: "unreachable", message: cannotReachGitHub.message },
    });

    github.failWith(undefined);
    const retried = await pageUntilSettled(core, "I_acme/api#1", () =>
      core.retry({ kind: "issue", issueId: "I_acme/api#1" }),
    );
    expect(retried.comments?.comments).toHaveLength(250);
    expect(retried.comments?.loading.status).toBe("current");
  });

  it("shows the comments as they arrive the first time", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Crash on start", comments: comments(150) },
    ]);
    const core = createTestCore(github);
    const pushed: IssuePage[] = [];
    core.on("issuePageChanged", (page) => pushed.push(page));

    await openPageUntilLoaded(core, "I_acme/api#1");

    expect(
      pushed
        .map((page) => [
          page.comments?.comments.length,
          page.comments?.loading.status,
        ])
        .filter(
          (state, index, states) =>
            index === 0 || !isDeepStrictEqual(state, states[index - 1]),
        ),
    ).toEqual([
      [undefined, undefined],
      [0, "loading"],
      [100, "loading"],
      [150, "current"],
    ]);
  });

  it("shows the comments as they were while all of them are read again", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Crash on start", comments: comments(150) },
    ]);
    const core = createTestCore(github);
    await openPageUntilLoaded(core, "I_acme/api#1");

    github.addRepository("acme/api", [
      { number: 1, title: "Crash on start", comments: comments(250) },
    ]);
    const pushed: IssuePage[] = [];
    core.on("issuePageChanged", (page) => pushed.push(page));
    await pageUntilSettled(core, "I_acme/api#1", () =>
      core.refresh({ kind: "issue", issueId: "I_acme/api#1" }),
    );

    expect(
      pushed
        .map((page) => [
          page.comments?.comments.length,
          page.comments?.loading.status,
        ])
        .filter(
          (state, index, states) =>
            index === 0 || !isDeepStrictEqual(state, states[index - 1]),
        ),
    ).toEqual([
      [150, "refreshing"],
      [250, "current"],
    ]);
  });

  it("keeps the comments read before when reading them again fails, marked stale", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Crash on start", comments: comments(3) },
    ]);
    const clock = createClock();
    const core = createTestCore(github, { clock });
    await openPageUntilLoaded(core, "I_acme/api#1");

    clock.advance(minute);
    github.addRepository("acme/api", [
      { number: 1, title: "Crash at start", comments: comments(3) },
    ]);
    // The issue is read again, and then its comments cannot be.
    github.pause("fetchIssueDetails");
    const refreshed = pageUntilSettled(core, "I_acme/api#1", () =>
      core.refresh({ kind: "issue", issueId: "I_acme/api#1" }),
    );
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });
    github.failWith(cannotReachGitHub);
    github.resume();
    const page = await refreshed;

    const problem = {
      kind: "unreachable",
      message: cannotReachGitHub.message,
    } as const;
    expect(page.issue?.title).toBe("Crash at start");
    expect(page.comments?.comments).toHaveLength(3);
    expect(page.comments?.loading).toEqual({
      status: "stale",
      updatedAt: startTime,
      problem,
    });
    expect(page.loading).toEqual({
      status: "stale",
      updatedAt: startTime,
      problem,
    });
  });

  it("says why the comments could not be read when none were, and reads them on Retry", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Crash on start", comments: comments(3) },
    ]);
    const core = createTestCore(github);
    github.pause("fetchIssueDetails");
    const loaded = openPageUntilLoaded(core, "I_acme/api#1");
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });
    github.failWith(cannotReachGitHub);
    github.resume();
    const page = await loaded;

    expect(page.comments).toEqual({
      comments: [],
      loading: {
        status: "failed",
        problem: { kind: "unreachable", message: cannotReachGitHub.message },
      },
    });

    github.failWith(undefined);
    const retried = await pageUntilSettled(core, "I_acme/api#1", () =>
      core.retry({ kind: "issue", issueId: "I_acme/api#1" }),
    );
    expect(retried.comments?.comments).toHaveLength(3);
  });

  it("shows no comments once GitHub no longer shows the issue", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Crash on start", comments: comments(3) },
    ]);
    const core = createTestCore(github);
    await openPageUntilLoaded(core, "I_acme/api#1");

    github.hide("acme/api#1");
    const page = await pageUntilSettled(core, "I_acme/api#1", () =>
      core.refresh({ kind: "issue", issueId: "I_acme/api#1" }),
    );

    expect(page.comments).toBeUndefined();
  });

  it("shows no comments read before once GitHub no longer shows them", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Crash on start", comments: comments(3) },
    ]);
    const core = createTestCore(github);
    await openPageUntilLoaded(core, "I_acme/api#1");

    github.pause("fetchIssueDetails");
    const refreshed = pageUntilSettled(core, "I_acme/api#1", () =>
      core.refresh({ kind: "issue", issueId: "I_acme/api#1" }),
    );
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });
    github.hide("acme/api#1");
    github.resume();
    const page = await refreshed;

    expect(page.comments).toEqual({
      comments: [],
      loading: {
        status: "failed",
        problem: { kind: "unavailable", access: undefined },
      },
    });
  });
});

describe("looking up issues by number", () => {
  it("finds an issue in any repository, without tracking it", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.addRepository("other/lib", [{ number: 5, title: "Leaks memory" }]);
    const core = createTestCore(github);

    expect(await core.lookUpIssue({ owner: "other", name: "lib" }, 5)).toEqual({
      status: "found",
      issue: {
        id: "I_other/lib#5",
        reference: "other/lib#5",
        title: "Leaks memory",
        url: "https://github.com/other/lib/issues/5",
      },
    });
    expect(sidebarLines(await readUntilCounted(core))).toEqual(["acme/api 1"]);
  });

  it("says a number that belongs to a pull request is one, with its page", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.addPullRequest("acme/api", 2);
    const core = createTestCore(github);

    expect(await core.lookUpIssue({ owner: "acme", name: "api" }, 2)).toEqual({
      status: "pull-request",
      url: "https://github.com/acme/api/pull/2",
    });
  });

  it("says why an issue could not be found", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    github.hide("acme/api#1");
    const core = createTestCore(github);

    expect(await core.lookUpIssue({ owner: "acme", name: "api" }, 1)).toEqual({
      status: "failed",
      problem: { kind: "unavailable", access: undefined },
    });
  });
});

describe("blocking maps through the contract", () => {
  it("marks omitted unreadable relationships with a lock even when GitHub reports why it omitted them", async () => {
    const github = createFakeGitHub({ login: "octo" });
    github.addRepository("acme/api", [
      { number: 1, title: "Centre", blockers: ["acme/api#2", "acme/api#3"] },
      { number: 2, title: "Readable" },
      { number: 3, title: "Unreadable" },
    ]);
    github.hide("acme/api#3");
    const page = await openPageUntilLoaded(
      createTestCore(github),
      "I_acme/api#1",
    );
    expect(page.blockingMap?.cards[0]?.badges.blockedBy).toEqual({
      kind: "inaccessible",
      count: 1,
    });
    expect(page.blockingMap?.ends.blockedBy).toEqual({ kind: "unknown" });
  });

  it("keeps an expanded chain unfolded when More reaches an inaccessible branch", async () => {
    const github = createFakeGitHub({ login: "octo" });
    github.addRepository("acme/api", [
      { number: 1, title: "Centre", blockers: ["acme/api#2"] },
      { number: 2, title: "Near", blockers: ["acme/api#3"] },
      { number: 3, title: "Two back", blockers: ["acme/api#4"] },
      {
        number: 4,
        title: "Inaccessible end",
        blockedBy: { open: 1, total: 1 },
      },
    ]);
    const core = createTestCore(github);
    let page = await openPageUntilLoaded(core, "I_acme/api#1");
    core.on("issuePageChanged", (changed) => {
      page = changed;
    });
    await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
    await vi.waitFor(() => {
      expect(page.blockingMap?.cards.at(-1)?.badges.blockedBy).toEqual({
        kind: "inaccessible",
        count: 1,
      });
    });
    await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
    expect(page.blockingMap?.cards).toHaveLength(4);
    expect(page.blockingMap?.ends.blockedBy).toEqual({ kind: "unknown" });
  });

  it("moves a direct blocker outward when exploration finds its longer route and relays out each refreshed list", async () => {
    const github = createFakeGitHub({ login: "octo" });
    const issues = [
      { number: 1, title: "Centre", blockers: ["acme/api#4", "acme/api#2"] },
      { number: 2, title: "Near", blockers: ["acme/api#3"] },
      { number: 3, title: "Two back", blockers: ["acme/api#4"] },
      { number: 4, title: "Direct and far" },
    ];
    github.addRepository("acme/api", issues);
    const core = createTestCore(github);
    let page = await openPageUntilLoaded(core, "I_acme/api#1");
    core.on("issuePageChanged", (changed) => {
      page = changed;
    });
    expect(
      page.blockingMap?.cards.find(
        ({ issue }) => issue.title === "Direct and far",
      )?.step,
    ).toBe(-1);
    await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
    await vi.waitFor(() => {
      expect(page.blockingMap?.ends.blockedBy.kind).toBe("expanded");
    });
    expect(
      page.blockingMap?.cards.find(
        ({ issue }) => issue.title === "Direct and far",
      )?.step,
    ).toBe(-3);
    github.addRepository(
      "acme/api",
      issues.map((issue) =>
        issue.number === 3 ? { ...issue, blockers: [] } : issue,
      ),
    );
    const updates: IssuePage[] = [];
    core.on("issuePageChanged", (changed) => updates.push(changed));
    await pageUntilSettled(core, "I_acme/api#1", () =>
      core.refresh({ kind: "issue", issueId: "I_acme/api#1" }),
    );
    expect(
      updates.some(
        (changed) =>
          changed.loading.status === "refreshing" &&
          changed.blockingMap?.cards.find(
            ({ issue }) => issue.title === "Direct and far",
          )?.step === -1,
      ),
    ).toBe(true);
  });

  it("retries failed branches with More and reveals a late cycle once its closing relationship loads", async () => {
    const github = createFakeGitHub({ login: "octo" });
    github.addRepository("acme/api", [
      { number: 1, title: "Centre", blockers: ["acme/api#2"] },
      { number: 2, title: "Near", blockers: ["acme/api#3"] },
      { number: 3, title: "Two back", blockers: ["acme/api#4"] },
      { number: 4, title: "Far", blockers: ["acme/api#5"] },
      { number: 5, title: "Cycle", blockers: ["acme/api#3"] },
    ]);
    const core = createTestCore(github);
    let page = await openPageUntilLoaded(core, "I_acme/api#1");
    core.on("issuePageChanged", (changed) => {
      page = changed;
    });
    expect(page.blockingMap?.edges.some(({ cycle }) => cycle)).toBe(false);
    github.failNextWith({ kind: "gh-failed", message: "Offline" });
    await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
    await vi.waitFor(() => {
      expect(page.blockingMap?.ends.blockedBy.kind).toBe("unknown");
    });
    await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
    await vi.waitFor(() => {
      expect(page.blockingMap?.ends.blockedBy.kind).toBe("expanded");
    });
    expect(page.blockingMap?.cards).toHaveLength(5);
    expect(page.blockingMap?.edges.filter(({ cycle }) => cycle)).toHaveLength(
      1,
    );
  });

  it("marks both of this issue's loading lists and distinguishes inaccessible relationships from an exact chain", async () => {
    const github = createFakeGitHub({ login: "octo" });
    github.addRepository("acme/api", [
      {
        number: 1,
        title: "Centre",
        blockedBy: { open: 3, total: 3 },
        blocking: { open: 2, total: 2 },
      },
    ]);
    const core = createTestCore(github);
    const pages: IssuePage[] = [];
    core.on("issuePageChanged", (page) => pages.push(page));
    await openPageUntilLoaded(core, "I_acme/api#1");
    expect(
      pages.some(
        (page) =>
          page.blockingMap?.cards[0]?.badges.blockedBy?.kind === "loading" &&
          page.blockingMap.cards[0].badges.blocking?.kind === "loading",
      ),
    ).toBe(true);
    expect(pages.at(-1)?.blockingMap?.cards[0]?.badges).toEqual({
      blockedBy: { kind: "inaccessible", count: 3 },
      blocking: { kind: "inaccessible", count: 2 },
    });
    expect(pages.at(-1)?.blockingMap?.ends).toEqual({
      blockedBy: { kind: "unknown" },
      blocking: { kind: "unknown" },
    });
  });

  it("drops a stopped expansion's rate-limited request instead of resuming it at reset", async () => {
    const clock = createClock();
    const github = createFakeGitHub({ login: "octo", now: clock.now });
    github.addRepository("acme/api", [
      { number: 1, title: "Centre", blockers: ["acme/api#2"] },
      { number: 2, title: "Near", blockers: ["acme/api#3"] },
      { number: 3, title: "Two back", blockers: ["acme/api#4"] },
      { number: 4, title: "End" },
    ]);
    const core = createTestCore(github, { clock, timers: true });
    let page = await openPageUntilLoaded(core, "I_acme/api#1");
    core.on("issuePageChanged", (changed) => {
      page = changed;
    });
    vi.useFakeTimers();
    try {
      github.setBudget("graphql", {
        remaining: 0,
        resetAt: clock.now() + minute,
      });
      await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
      await vi.waitFor(() => {
        expect(page.blockingMap?.cards.at(-1)?.badges.blockedBy?.kind).toBe(
          "paused",
        );
      });
      expect(await core.getRateLimits()).toContainEqual({
        pool: "graphql",
        status: "paused",
        until: clock.now() + minute,
      });
      await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
      const reads = github.requestsReceived;
      await passTime(clock, minute);
      expect(github.requestsReceived).toBe(reads);
      expect(page.blockingMap?.cards).toHaveLength(3);
      expect(page.blockingMap?.ends.blockedBy).toEqual({ kind: "unknown" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a failed branch for retry and keeps the total unknown until exploration succeeds", async () => {
    const github = createFakeGitHub({ login: "octo" });
    github.addRepository("acme/api", [
      { number: 1, title: "Centre", blockers: ["acme/api#2"] },
      { number: 2, title: "Near", blockers: ["acme/api#3"] },
      { number: 3, title: "Two back", blockers: ["acme/api#4"] },
      { number: 4, title: "End" },
    ]);
    const core = createTestCore(github);
    let page = await openPageUntilLoaded(core, "I_acme/api#1");
    core.on("issuePageChanged", (changed) => {
      page = changed;
    });
    github.failNextWith({ kind: "gh-failed", message: "Offline" });
    await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
    await vi.waitFor(() => {
      expect(page.blockingMap?.cards.at(-1)?.badges.blockedBy?.kind).toBe(
        "failed",
      );
    });
    expect(page.blockingMap?.ends.blockedBy).toEqual({ kind: "unknown" });
    await core.retryBlockingBranch("I_acme/api#1", "I_acme/api#3", "blockedBy");
    await vi.waitFor(() => {
      expect(page.blockingMap?.ends.blockedBy).toEqual({ kind: "expanded" });
    });
    expect(page.blockingMap?.problems).toEqual([]);
    expect(page.blockingMap?.cards).toHaveLength(4);
  });

  it.each([40, 60])(
    "pauses after 40 additional issues in a %i-issue relationship list, then continues without folding",
    async (total) => {
      const github = createFakeGitHub({ login: "octo" });
      github.addRepository("acme/api", [
        { number: 1, title: "Centre", blockers: ["acme/api#2"] },
        { number: 2, title: "Near", blockers: ["acme/api#3"] },
        {
          number: 3,
          title: "Fan out",
          blockers: Array.from(
            { length: total },
            (_, i) => `acme/api#${String(i + 4)}`,
          ),
        },
        ...Array.from({ length: total }, (_, i) => ({
          number: i + 4,
          title: `Far ${String(i)}`,
        })),
      ]);
      const core = createTestCore(github);
      let page = await openPageUntilLoaded(core, "I_acme/api#1");
      core.on("issuePageChanged", (changed) => {
        page = changed;
      });
      await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
      await vi.waitFor(() => {
        expect(page.blockingMap?.ends.blockedBy).toEqual({ kind: "paused" });
      });
      expect(page.blockingMap?.cards).toHaveLength(43);
      expect(
        page.blockingMap?.cards.find(({ issue }) => issue.title === "Fan out")
          ?.badges.blockedBy,
      ).toEqual(total === 60 ? { kind: "unloaded", count: 20 } : undefined);
      await pageUntilSettled(core, "I_acme/api#1", () =>
        core.refresh({ kind: "issue", issueId: "I_acme/api#1" }),
      );
      expect(page.blockingMap?.cards).toHaveLength(43);
      expect(page.blockingMap?.ends.blockedBy).toEqual({ kind: "paused" });
      await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
      await vi.waitFor(() => {
        expect(page.blockingMap?.ends.blockedBy).toEqual({ kind: "expanded" });
      });
      expect(page.blockingMap?.cards).toHaveLength(total === 60 ? 63 : 43);
      await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
      expect(page.blockingMap?.ends.blockedBy).toEqual({
        kind: "folded",
        count: total,
      });
    },
  );

  it("stops exploration while running requests finish into the cache", async () => {
    const github = createFakeGitHub({ login: "octo" });
    github.addRepository(
      "acme/api",
      Array.from({ length: 6 }, (_, index) => ({
        number: index + 1,
        title: `Issue ${String(index + 1)}`,
        blockers: index < 5 ? [`acme/api#${String(index + 2)}`] : [],
      })),
    );
    const core = createTestCore(github);
    let page = await openPageUntilLoaded(core, "I_acme/api#1");
    core.on("issuePageChanged", (changed) => {
      page = changed;
    });
    github.pause("fetchRelationships");
    await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
    await vi.waitFor(() => {
      expect(github.requestsInFlight).toBe(1);
    });
    expect(page.blockingMap?.ends.blockedBy).toEqual({
      kind: "loading",
      count: 2,
    });
    await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
    expect(page.blockingMap?.ends.blockedBy).toEqual({ kind: "unknown" });
    github.resume();
    await vi.waitFor(() => {
      expect(page.blockingMap?.cards).toHaveLength(4);
    });
    expect(page.blockingMap?.cards.at(-1)?.badges.blockedBy).toEqual({
      kind: "unloaded",
      count: 1,
    });
    expect(github.received).not.toContain(
      "fetchRelationships acme/api#4 blockedBy",
    );
  });

  it("explores a side progressively, then folds and unfolds its complete chain from cache", async () => {
    const github = createFakeGitHub({ login: "octo" });
    github.addRepository("acme/api", [
      { number: 1, title: "Centre", blockers: ["acme/api#2"] },
      { number: 2, title: "Near", blockers: ["acme/api#3"] },
      { number: 3, title: "Two back", blockers: ["acme/api#4"] },
      { number: 4, title: "Far", blockers: ["acme/api#5"] },
      { number: 5, title: "End" },
    ]);
    const core = createTestCore(github);
    await openPageUntilLoaded(core, "I_acme/api#1");
    const pages: IssuePage[] = [];
    core.on("issuePageChanged", (page) => pages.push(page));
    await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
    await vi.waitFor(() => {
      expect(pages.at(-1)?.blockingMap?.ends.blockedBy).toEqual({
        kind: "expanded",
      });
    });
    expect(pages.some((page) => page.blockingMap?.cards.length === 4)).toBe(
      true,
    );
    expect(pages.at(-1)?.blockingMap?.cards.map(({ step }) => step)).toEqual([
      0, -1, -2, -3, -4,
    ]);
    const reads = github.received.length;
    await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
    expect(pages.at(-1)?.blockingMap?.ends.blockedBy).toEqual({
      kind: "folded",
      count: 2,
    });
    expect(pages.at(-1)?.blockingMap?.cards).toHaveLength(3);
    await core.activateBlockingEnd("I_acme/api#1", "blockedBy");
    expect(pages.at(-1)?.blockingMap?.cards).toHaveLength(5);
    expect(github.received).toHaveLength(reads);
  });

  it("loads two steps each way and leaves farther relationships counted, not followed", async () => {
    const github = createFakeGitHub({ login: "octo" });
    github.addRepository("acme/api", [
      { number: 1, title: "This issue", blockers: ["acme/api#2"] },
      { number: 2, title: "One back", blockers: ["acme/api#3"] },
      { number: 3, title: "Two back", blockers: ["acme/api#4"] },
      { number: 4, title: "Beyond" },
      { number: 5, title: "One on", blockers: ["acme/api#1"] },
      { number: 6, title: "Two on", blockers: ["acme/api#5"] },
    ]);
    const core = createTestCore(github);
    const page = await openPageUntilLoaded(core, "I_acme/api#1");
    expect(
      page.blockingMap?.cards.map(({ issue, step }) => [issue.title, step]),
    ).toEqual([
      ["This issue", 0],
      ["One back", -1],
      ["Two back", -2],
      ["One on", 1],
      ["Two on", 2],
    ]);
    expect(
      page.blockingMap?.cards.find(({ issue }) => issue.title === "Two back")
        ?.badges.blockedBy,
    ).toEqual({ kind: "unloaded", count: 1 });
    expect(page.blockingMap?.edges).toHaveLength(4);
    expect(page.blockingMap?.ends).toEqual({
      blockedBy: { kind: "unknown" },
      blocking: { kind: "none" },
    });
    expect(
      github.received.filter((read) => read.startsWith("fetchRelationships")),
    ).toEqual([
      "fetchRelationships acme/api#1 blockedBy",
      "fetchRelationships acme/api#1 blocking",
      "fetchRelationships acme/api#2 blockedBy",
      "fetchRelationships acme/api#5 blocking",
    ]);
  });
});

it("places a diamond once on its longest loaded route and folds farther loaded cards exactly", async () => {
  const github = createFakeGitHub({ login: "octo" });
  github.addRepository("acme/api", [
    {
      number: 1,
      title: "Centre",
      blockers: ["acme/api#3", "acme/api#2", "acme/api#4"],
    },
    { number: 2, title: "Near", blockers: ["acme/api#3"] },
    { number: 3, title: "Diamond", blockers: ["acme/api#4"] },
    { number: 4, title: "Far" },
  ]);
  const page = await openPageUntilLoaded(
    createTestCore(github),
    "I_acme/api#1",
  );
  expect(
    page.blockingMap?.cards.map(({ issue, step }) => [issue.title, step]),
  ).toEqual([
    ["Centre", 0],
    ["Diamond", -2],
    ["Near", -1],
  ]);
  expect(
    page.blockingMap?.edges.filter(({ from }) => from === "I_acme/api#3"),
  ).toEqual([
    { from: "I_acme/api#3", to: "I_acme/api#1", cycle: false, closed: false },
    { from: "I_acme/api#3", to: "I_acme/api#2", cycle: false, closed: false },
  ]);
  expect(page.blockingMap?.ends).toEqual({
    blockedBy: { kind: "folded", count: 1 },
    blocking: { kind: "none" },
  });
});

it("marks a cycle once without duplicating issues and stops at closed issues on both sides", async () => {
  const github = createFakeGitHub({ login: "octo" });
  github.addRepository("acme/api", [
    { number: 1, title: "Centre", blockers: ["acme/api#2", "acme/api#4"] },
    { number: 2, title: "Cycle", blockers: ["acme/api#1"] },
    {
      number: 4,
      title: "Closed blocker",
      state: "closed",
      blockers: ["acme/api#5"],
    },
    { number: 5, title: "Not followed back" },
    {
      number: 6,
      title: "Closed waiting",
      state: "closed",
      blockers: ["acme/api#1"],
    },
    { number: 7, title: "Not followed on", blockers: ["acme/api#6"] },
  ]);
  const core = createTestCore(github);
  const page = await openPageUntilLoaded(core, "I_acme/api#1");
  expect(page.blockingMap?.cards.map(({ issue }) => issue.title)).toEqual([
    "Centre",
    "Cycle",
    "Closed blocker",
    "Closed waiting",
  ]);
  expect(page.blockingMap?.edges.some(({ cycle }) => cycle)).toBe(true);
  expect(page.blockingMap?.edges).toHaveLength(4);
  expect(
    page.blockingMap?.cards
      .filter(({ issue }) => issue.state === "closed")
      .map(({ badges }) => badges),
  ).toEqual([
    { blockedBy: { kind: "closed" } },
    { blocking: { kind: "closed" } },
  ]);
  expect(page.blockingMap?.edges.filter(({ closed }) => closed)).toHaveLength(
    2,
  );
  expect(page.blockingMap?.ends).toEqual({
    blockedBy: { kind: "none" },
    blocking: { kind: "none" },
  });
  expect(
    github.received.some((read) =>
      /fetchRelationships acme\/api#[4567] /.test(read),
    ),
  ).toBe(false);
});

it("refreshes all loaded map cards even when a failed relationship list retains its old cards", async () => {
  const github = createFakeGitHub({ login: "octo" });
  github.addRepository("acme/api", [
    { number: 1, title: "Centre", blockers: ["acme/api#2"] },
    { number: 2, title: "Blocker", blockers: ["acme/api#3"] },
    { number: 3, title: "Two back" },
  ]);
  const core = createTestCore(github);
  await openPageUntilLoaded(core, "I_acme/api#1");
  github.hide("acme/api#3");
  const page = await pageUntilSettled(core, "I_acme/api#1", () =>
    core.refresh({ kind: "issue", issueId: "I_acme/api#1" }),
  );
  expect(page.blockingMap?.cards.map(({ issue }) => issue.title)).toEqual([
    "Centre",
    "Blocker",
  ]);
  expect(page.blockingMap?.ends.blockedBy).toEqual({ kind: "unknown" });
  expect(page.blockingMap?.problems).not.toEqual([]);
});

it("refreshes the loaded chain beyond two steps and keeps an unknown total ahead of a folded count", async () => {
  const github = createFakeGitHub({ login: "octo" });
  const issues = [
    { number: 1, title: "Centre", blockers: ["acme/api#2"] },
    { number: 2, title: "Near", blockers: ["acme/api#3"] },
    { number: 3, title: "Two back", blockers: ["acme/api#4"] },
    { number: 4, title: "Folded", blockers: ["acme/api#5"] },
    { number: 5, title: "Loaded end", blockers: ["acme/api#6"] },
    { number: 6, title: "Unloaded" },
  ];
  github.addRepository("acme/api", issues);
  const core = createTestCore(github);
  await openPageUntilLoaded(core, "I_acme/api#3");
  const first = await openPageUntilLoaded(core, "I_acme/api#1");
  expect(first.blockingMap?.ends.blockedBy).toEqual({ kind: "unknown" });
  github.addRepository(
    "acme/api",
    issues.map((issue) =>
      issue.number === 4 ? { ...issue, blockers: [] } : issue,
    ),
  );
  const refreshed = await pageUntilSettled(core, "I_acme/api#1", () =>
    core.refresh({ kind: "issue", issueId: "I_acme/api#1" }),
  );
  expect(refreshed.blockingMap?.ends.blockedBy).toEqual({
    kind: "folded",
    count: 1,
  });
});

it("paginates blocking lists and retries a failed side without reporting it as empty", async () => {
  const github = createFakeGitHub({ login: "octo", issuesPerPage: 1 });
  github.addRepository("acme/api", [
    { number: 1, title: "Centre", blockers: ["acme/api#2", "acme/api#3"] },
    { number: 2, title: "First" },
    { number: 3, title: "Second" },
  ]);
  vi.spyOn(github, "fetchRelationships").mockResolvedValueOnce({
    ok: false,
    error: { kind: "gh-failed", message: "Offline" },
    budget: undefined,
    viewerLogin: undefined,
  });
  const core = createTestCore(github);
  const failed = await openPageUntilLoaded(core, "I_acme/api#1");
  expect(failed.blockingMap?.ends.blockedBy).toEqual({ kind: "unknown" });
  expect(failed.blockingMap?.cards[0]?.badges.blockedBy).toEqual({
    kind: "failed",
    problem: { kind: "unreachable", message: "Offline" },
  });
  const retried = await pageUntilSettled(core, "I_acme/api#1", () =>
    core.retry({ kind: "issue", issueId: "I_acme/api#1" }),
  );
  expect(retried.blockingMap?.cards.map(({ issue }) => issue.title)).toEqual([
    "Centre",
    "First",
    "Second",
  ]);
  expect(retried.blockingMap?.ends.blockedBy).toEqual({ kind: "none" });
});

it("refreshes cached cards themselves when re-reading the list that names them fails", async () => {
  const github = createFakeGitHub({ login: "octo" });
  github.addRepository("acme/api", [
    { number: 1, title: "Centre", blockers: ["acme/api#2"] },
    { number: 2, title: "Old title" },
  ]);
  const core = createTestCore(github);
  await openPageUntilLoaded(core, "I_acme/api#1");
  github.addRepository("acme/api", [
    { number: 1, title: "Centre", blockers: ["acme/api#2"] },
    { number: 2, title: "New title", state: "closed" },
  ]);
  vi.spyOn(github, "fetchRelationships").mockResolvedValueOnce({
    ok: false,
    error: { kind: "gh-failed", message: "Offline" },
    budget: undefined,
    viewerLogin: undefined,
  });
  const refreshed = await pageUntilSettled(core, "I_acme/api#1", () =>
    core.refresh({ kind: "issue", issueId: "I_acme/api#1" }),
  );
  expect(
    refreshed.blockingMap?.cards.map(({ issue }) => [issue.title, issue.state]),
  ).toEqual([
    ["Centre", "open"],
    ["New title", "closed"],
  ]);
  expect(refreshed.blockingMap?.ends.blockedBy).toEqual({ kind: "unknown" });
});

it("updates All from hand-edited tracking and keeps the last valid scope while settings are broken", async () => {
  await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
  const github = createFakeGitHub({ login: "octo-reader" });
  github.addRepository("acme/api", [{ number: 1, title: "API work" }]);
  github.addRepository("acme/web", [{ number: 2, title: "Web work" }]);
  const core = createTestCore(github);
  await openUntilLoaded(core, all);
  const pushed: IssueList[] = [];
  core.on("listChanged", (list) => pushed.push(list));
  await writeSettings({ version: 1, repositories: [{ name: "acme/web" }] });
  await expect
    .poll(() => pushed.at(-1) && outline(pushed.at(-1) as IssueList))
    .toEqual(["acme/web #2 Web work"]);
  await writeFile(join(home, "settings.json"), "broken");
  expect(outline(await openUntilLoaded(core, all))).toEqual([
    "acme/web #2 Web work",
  ]);
});

describe("removing tracked repositories", () => {
  it("moves a removed selection to the next repository, then the previous, then All, keeping views and persisting removal", async () => {
    await writeSettings({
      version: 1,
      repositories: ["acme/api", "acme/web", "acme/tools"].map((name) => ({
        name,
      })),
      views: [{ id: "bugs", name: "Bugs", query: "repo:acme/web label:bug" }],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    for (const name of ["api", "web", "tools"])
      github.addRepository(`acme/${name}`, []);
    const core = createTestCore(github);
    await core.selectSidebarEntry({
      kind: "repository",
      repository: { owner: "acme", name: "web" },
    });

    expect(
      await core.removeRepository({ owner: "acme", name: "web" }),
    ).toMatchObject({ ok: true });
    expect(await core.getSelectedSidebarEntry()).toEqual({
      kind: "repository",
      repository: { owner: "acme", name: "tools" },
    });
    expect(
      await core.removeRepository({ owner: "acme", name: "tools" }),
    ).toMatchObject({ ok: true });
    expect(await core.getSelectedSidebarEntry()).toEqual({
      kind: "repository",
      repository: { owner: "acme", name: "api" },
    });
    expect(
      await core.removeRepository({ owner: "acme", name: "api" }),
    ).toMatchObject({ ok: true });
    expect(await core.getSelectedSidebarEntry()).toEqual({ kind: "all" });
    expect(await createTestCore(github).getSidebar()).toMatchObject({
      repositories: [],
      views: [{ id: "bugs", name: "Bugs", query: "repo:acme/web label:bug" }],
    });
  });
});

it("removes issues from All immediately, keeps related external issues and cached pages, and re-adds with fresh list state", async () => {
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/web" }, { name: "acme/api" }],
  });
  const github = createFakeGitHub({ login: "octo-reader" });
  github.addRepository("acme/api", [
    { number: 1, title: "API", subIssues: ["acme/web#1"] },
    { number: 2, title: "Protocol" },
  ]);
  github.addRepository("acme/web", [
    { number: 1, title: "Web" },
    { number: 2, title: "Parent", subIssues: ["acme/api#2"] },
    { number: 3, title: "Unrelated" },
  ]);
  const core = createTestCore(github);
  const web = {
    kind: "repository" as const,
    repository: { owner: "acme", name: "web" },
  };
  await openUntilLoaded(core, web);
  await core.setAllExpanded(web, false);
  await core.selectSidebarEntry({ kind: "all" });
  await openUntilLoaded(core, { kind: "all" });
  await openPageUntilLoaded(core, "I_acme/web#1");
  await openPageUntilLoaded(core, "I_acme/web#3");
  let all: IssueList | undefined;
  let page: IssuePage | undefined;
  core.on("listChanged", (list) => {
    if (list.scope.kind === "all") all = list;
  });
  core.on("issuePageChanged", (pushed) => {
    if (pushed.issueId === "I_acme/web#3") page = pushed;
  });
  const reads = github.requestsReceived;

  expect(await core.removeRepository(web.repository)).toEqual({
    ok: true,
    selection: { kind: "all" },
  });
  expect(all?.loading).toMatchObject({ status: "current", openIssues: 2 });
  expect(all?.trees.map((node) => node.issue.id)).not.toContain("I_acme/web#3");
  const api = all?.trees.find((node) => node.issue.id === "I_acme/api#1");
  expect(readSummary(api?.subIssues[0])).toMatchObject({
    id: "I_acme/web#1",
    external: true,
  });
  const protocol = all?.trees.find((node) => node.issue.id === "I_acme/api#2");
  expect(protocol?.parent).toMatchObject({
    reference: "acme/web#2",
    external: true,
  });
  expect(page?.issue).toMatchObject({ id: "I_acme/web#3", external: true });
  expect((await openPageUntilLoaded(core, "I_acme/web#1")).issue).toMatchObject(
    { external: true },
  );
  expect(github.requestsReceived).toBe(reads);
  expect(sidebarLines(await core.getSidebar())).toEqual(["acme/api 2"]);

  await core.addRepositories([web.repository]);
  expect(sidebarLines(await core.getSidebar())).toEqual([
    "acme/api 2",
    "acme/web 3",
  ]);
  const readded = await openUntilLoaded(core, web);
  expect(
    readded.trees.find((node) => node.issue.id === "I_acme/web#2")?.expanded,
  ).toBe(true);
});

it("drops unstarted repository reads and removes it from queued count batches while All keeps loading", async () => {
  const github = createFakeGitHub({ login: "octo-reader" });
  const names = ["one", "two", "three", "four", "five", "six"];
  for (const name of names)
    github.addRepository(`acme/${name}`, [{ number: 1, title: name }]);
  await writeSettings({
    version: 1,
    repositories: names.map((name) => ({ name: `acme/${name}` })),
  });
  const core = createTestCore(github);
  await checkedSetup(core);
  github.pause();
  await core.openList({ kind: "all" });
  await vi.waitFor(() => {
    expect(github.requestsInFlight).toBe(4);
  });
  await core.getSidebar();
  expect(
    await core.removeRepository({ owner: "acme", name: "six" }),
  ).toMatchObject({ ok: true });
  const settled = untilSettled(core, { kind: "all" }, () => {
    github.resume();
    return Promise.resolve();
  });
  expect((await settled).trees).toHaveLength(5);
  await vi.waitFor(() => {
    expect(github.requestsInFlight).toBe(0);
  });
  expect(github.received.some((read) => read.includes("acme/six"))).toBe(false);
});

it.each([
  { kind: "repository" as const, repository: { owner: "acme", name: "api" } },
  { kind: "view" as const, id: "bugs" },
])(
  "keeps an unremoved selection and its open issue page (%s)",
  async (selection) => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    github.addRepository("acme/web", [{ number: 1, title: "Reading" }]);
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
      views: [{ id: "bugs", name: "Bugs", query: "repo:acme/web" }],
    });
    const core = createTestCore(github);
    await core.selectSidebarEntry(selection);
    const before = await core.getSelectedSidebarEntry();
    const page = await openPageUntilLoaded(core, "I_acme/web#1");
    const after = await pageUntilSettled(core, page.issueId, async () => {
      expect(
        await core.removeRepository({ owner: "acme", name: "web" }),
      ).toEqual({ ok: true, selection: before });
    });
    expect(after.issue).toMatchObject({ id: page.issueId, external: true });
    expect(after.issue).toEqual({ ...page.issue, external: true });
    expect(await core.getSelectedSidebarEntry()).toEqual(before);
  },
);

it.each([
  "{broken",
  JSON.stringify({ version: 2, repositories: [{ name: "acme/api" }] }),
])(
  "leaves tracking and selection in place when removal cannot be saved (%s)",
  async (contents) => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Keep" }]);
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const core = createTestCore(github);
    const selection = {
      kind: "repository" as const,
      repository: { owner: "acme", name: "api" },
    };
    await core.selectSidebarEntry(selection);
    await openUntilLoaded(core, selection);
    await writeFile(join(home, "settings.json"), contents);
    expect(await core.removeRepository(selection.repository)).toMatchObject({
      ok: false,
    });
    expect(await core.getSelectedSidebarEntry()).toEqual(selection);
    expect(sidebarLines(await core.getSidebar())).toEqual(["acme/api 1"]);
    expect(await readFile(join(home, "settings.json"), "utf8")).toBe(contents);
  },
);

it("drops queued sub-issue reads that only the removed repository's All tree needed", async () => {
  const github = createFakeGitHub({ login: "octo-reader" });
  const children = Array.from({ length: 501 }, (_, index) => ({
    number: index + 2,
    title: `Sub-issue ${String(index)}`,
    state: "closed" as const,
  }));
  github.addRepository("acme/api", [
    {
      number: 1,
      title: "Parent",
      subIssues: children.map(({ number }) => `acme/api#${String(number)}`),
    },
    ...children,
  ]);
  await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
  const core = createTestCore(github);
  await checkedSetup(core);
  github.pause("fetchIssues");
  await core.openList({ kind: "all" });
  await vi.waitFor(() => {
    expect(github.requestsInFlight).toBe(4);
  });
  await core.removeRepository({ owner: "acme", name: "api" });
  github.resume();
  await vi.waitFor(() => {
    expect(github.requestsInFlight).toBe(0);
  });
  expect(github.received.some((read) => read.includes("acme/api#502"))).toBe(
    false,
  );
  expect((await openUntilLoaded(core, { kind: "all" })).trees).toEqual([]);
});

it("removes only the requested repository identity when its old name has been reused", async () => {
  const github = createFakeGitHub({ login: "octo-reader" });
  github.addRepository("acme/api", []);
  await writeSettings({
    version: 1,
    repositories: [
      { name: "acme/api", id: 42 },
      { name: "acme/api", id: 99 },
    ],
  });
  const core = createTestCore(github);
  await core.selectSidebarEntry({
    kind: "repository",
    repository: { owner: "acme", name: "api" },
  });
  expect(
    await core.removeRepository({ owner: "acme", name: "api", id: 99 }),
  ).toMatchObject({ ok: true });
  expect(await core.getSidebar()).toMatchObject({
    repositories: [{ repository: { owner: "acme", name: "api", id: 42 } }],
  });
  expect(await core.getSelectedSidebarEntry()).toEqual({
    kind: "repository",
    repository: { owner: "acme", name: "api" },
  });
});

it("keeps the restored selection's identity for keyboard removal when an address is reused", async () => {
  const github = createFakeGitHub({ login: "octo-reader" });
  github.addRepository("acme/api", []);
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api", id: 99 }],
  });
  const core = createTestCore(github);
  await core.selectSidebarEntry({
    kind: "repository",
    repository: { owner: "acme", name: "api" },
  });
  await writeSettings({
    version: 1,
    repositories: [
      { name: "acme/api", id: 42 },
      { name: "acme/api", id: 99 },
    ],
  });
  const restarted = createTestCore(github);
  const selection = await restarted.getSelectedSidebarEntry();
  if (selection.kind !== "repository")
    throw new Error("Expected repository selection");
  expect(await restarted.removeRepository(selection.repository)).toMatchObject({
    ok: true,
  });
  expect(await restarted.getSidebar()).toMatchObject({
    repositories: [{ repository: { owner: "acme", name: "api", id: 42 } }],
  });
});

it("loads a removed repository's parent when a remaining in-flight response reveals it later", async () => {
  const github = createFakeGitHub({ login: "octo-reader" });
  const children = Array.from({ length: 501 }, (_, index) => ({
    number: index + 2,
    title: `Child ${String(index)}`,
    state: "closed" as const,
    ...(index === 500 ? { subIssues: ["acme/web#1"] } : {}),
  }));
  github.addRepository("acme/api", [
    {
      number: 1,
      title: "Removed parent",
      subIssues: children.map(({ number }) => `acme/api#${String(number)}`),
    },
    ...children,
  ]);
  github.addRepository("acme/web", [{ number: 1, title: "Remaining child" }]);
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }, { name: "acme/web" }],
  });
  const heldIssues = Promise.withResolvers<undefined>();
  const heldWeb = Promise.withResolvers<undefined>();
  const fetchIssues = github.fetchIssues.bind(github);
  const fetchOpenIssues = github.fetchOpenIssues.bind(github);
  let issueReads = 0;
  github.fetchIssues = async (ids) => {
    issueReads++;
    const answer = await fetchIssues(ids);
    await heldIssues.promise;
    return answer;
  };
  github.fetchOpenIssues = async (repository, after) => {
    const answer = await fetchOpenIssues(repository, after);
    if (repository.name === "web") await heldWeb.promise;
    return answer;
  };
  const core = createTestCore(github);
  await checkedSetup(core);
  await core.openList({ kind: "all" });
  try {
    await vi.waitFor(() => {
      expect(issueReads).toBe(3);
    });
    await core.removeRepository({ owner: "acme", name: "api" });
  } finally {
    heldWeb.resolve(undefined);
    heldIssues.resolve(undefined);
  }
  const list = await openUntilLoaded(core, { kind: "all" });
  expect(list.trees).toHaveLength(1);
  expect(list.trees[0]?.parent).toMatchObject({
    id: "I_acme/api#502",
    external: true,
  });
  expect(list.trees[0]?.parent?.unread).toBeUndefined();
});
