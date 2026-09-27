import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Account, Contract, IssueList, Scope } from "./contract.ts";
import { createCore } from "./core.ts";
import { createSettingsFile } from "./settings/settings-file.ts";
import { createFakeGitHub, type FakeGitHub } from "./testing/fake-github.ts";

/** A temporary `VERDANDI_HOME`, so tests never touch the real user data. */
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "verdandi-test-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** Writes `settings.json` as the user would, by hand. */
async function writeSettings(settings: unknown) {
  await writeFile(join(home, "settings.json"), JSON.stringify(settings));
}

/** The core on a fake GitHub, with the real settings file below `home`. */
function createTestCore(github: FakeGitHub): Contract {
  return createCore({
    github,
    settings: createSettingsFile({
      platform: process.platform,
      env: { VERDANDI_HOME: home },
      homedir: join(home, "no-such-home"),
    }),
  });
}

/** Opens a scope's list and waits until it has stopped loading. */
async function openUntilLoaded(
  core: Contract,
  scope: Scope,
): Promise<IssueList> {
  const settled = new Promise<IssueList>((resolve) => {
    const unsubscribe = core.on("listChanged", (list) => {
      if (
        isDeepStrictEqual(list.scope, scope) &&
        list.loading.status !== "loading"
      ) {
        unsubscribe();
        resolve(list);
      }
    });
  });
  await core.openList(scope);
  return settled;
}

const acmeApi: Scope = {
  kind: "repository",
  repository: { owner: "acme", name: "api" },
};

const acmeWeb: Scope = {
  kind: "repository",
  repository: { owner: "acme", name: "web" },
};

describe("account", () => {
  it("reports the account GitHub answers as", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await core.getAccount()).toEqual({
      status: "known",
      account: { login: "octo-reader", host: "github.com" },
    });
  });

  it("reports that gh is missing", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.failWith({ kind: "gh-not-found" });
    const core = createTestCore(github);

    expect(await core.getAccount()).toEqual({
      status: "failed",
      message: "GitHub CLI (gh) was not found on PATH.",
    });
  });

  it("reports why gh failed", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.failWith({
      kind: "gh-failed",
      message: "To get started with GitHub CLI, please run:  gh auth login",
    });
    const core = createTestCore(github);

    expect(await core.getAccount()).toEqual({
      status: "failed",
      message:
        "GitHub CLI (gh) failed: To get started with GitHub CLI, please run:  gh auth login",
    });
  });

  it("pushes an account change when GitHub answers as another account", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github);
    const changes: Account[] = [];
    core.on("accountChanged", (account) => changes.push(account));

    await core.getAccount();
    github.signInAs("octo-writer");
    await core.getAccount();

    expect(changes).toEqual([{ login: "octo-writer", host: "github.com" }]);
  });
});

describe("GitHub requests", () => {
  it("are sent at most four at a time", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github);
    github.pause();

    const answers = Array.from({ length: 10 }, () => core.getAccount());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(github.requestsInFlight).toBe(4);

    github.resume();
    expect(await Promise.all(answers)).toHaveLength(10);
  });
});

describe("sidebar", () => {
  it("lists no tracked repositories before the settings file exists", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await core.getSidebar()).toEqual({
      status: "read",
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

    expect(await core.getSidebar()).toEqual({
      status: "read",
      repositories: [
        { owner: "acme", name: "web" },
        { owner: "acme", name: "api" },
        { owner: "octo-org", name: "tools" },
      ],
    });
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
    const core = createCore({
      github: createFakeGitHub({ login: "octo-reader" }),
      // Without VERDANDI_HOME, APPDATA or XDG_DATA_HOME, the default applies.
      settings: createSettingsFile({
        platform: process.platform,
        env: {},
        homedir,
      }),
    });

    expect(await core.getSidebar()).toEqual({
      status: "read",
      repositories: [{ owner: "acme", name: "api" }],
    });
  });

  it("says where the settings file is when it is not JSON", async () => {
    await writeFile(join(home, "settings.json"), '{ "repositories": [ }');
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await core.getSidebar()).toEqual({
      status: "failed",
      message: expect.stringContaining(
        `${join(home, "settings.json")} is not valid JSON:`,
      ) as unknown,
    });
  });

  it("says which tracked repository has no owner/name", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "web" }],
      views: [],
    });
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await core.getSidebar()).toEqual({
      status: "failed",
      message: `${join(home, "settings.json")}: repositories[1].name is not "owner/name".`,
    });
  });

  it("says why the settings file cannot be read", async () => {
    await mkdir(join(home, "settings.json"));
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await core.getSidebar()).toEqual({
      status: "failed",
      message: expect.stringContaining(
        `Cannot read ${join(home, "settings.json")}:`,
      ) as unknown,
    });
  });
});

describe("repository list", () => {
  it("shows a tracked repository's open issues", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { id: "I_api3", number: 3, title: "Retry webhooks", state: "open" },
      { id: "I_api1", number: 1, title: "Crash on start", state: "open" },
    ]);
    const core = createTestCore(github);

    expect(await openUntilLoaded(core, acmeApi)).toEqual({
      scope: { kind: "repository", repository: { owner: "acme", name: "api" } },
      issues: [
        { id: "I_api3", number: 3, title: "Retry webhooks", state: "open" },
        { id: "I_api1", number: 1, title: "Crash on start", state: "open" },
      ],
      loading: { status: "loaded" },
    });
  });

  it("shows the issues page by page as they arrive", async () => {
    const github = createFakeGitHub({ login: "octo-reader", issuesPerPage: 2 });
    github.addRepository("acme/api", [
      { id: "I_api5", number: 5, title: "Dark mode", state: "open" },
      { id: "I_api4", number: 4, title: "Audit trail", state: "open" },
      { id: "I_api2", number: 2, title: "CSV import", state: "open" },
    ]);
    const core = createTestCore(github);
    const pushed: IssueList[] = [];
    core.on("listChanged", (list) => pushed.push(list));

    await openUntilLoaded(core, acmeApi);

    expect(
      pushed.map(({ issues, loading }) => ({
        numbers: issues.map((issue) => issue.number),
        loading: loading.status,
      })),
    ).toEqual([
      { numbers: [], loading: "loading" },
      { numbers: [5, 4], loading: "loading" },
      { numbers: [5, 4, 2], loading: "loaded" },
    ]);
  });

  it("loads only the opened repository, not every tracked one", async () => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
      views: [],
    });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { id: "I_api1", number: 1, title: "Crash on start", state: "open" },
    ]);
    github.addRepository("acme/web", [
      { id: "I_web1", number: 1, title: "Broken footer", state: "open" },
    ]);
    const core = createTestCore(github);

    await core.getSidebar();
    await openUntilLoaded(core, acmeApi);

    expect(github.requestsFor("acme/api")).toBeGreaterThan(0);
    expect(github.requestsFor("acme/web")).toBe(0);
  });

  it("shows a loaded repository again without asking GitHub", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { id: "I_api1", number: 1, title: "Crash on start", state: "open" },
    ]);
    github.addRepository("acme/web", [
      { id: "I_web1", number: 1, title: "Broken footer", state: "open" },
    ]);
    const core = createTestCore(github);

    await openUntilLoaded(core, acmeApi);
    await openUntilLoaded(core, acmeWeb);
    const requestsBefore = github.requestsFor("acme/api");
    const revisited = await openUntilLoaded(core, acmeApi);

    expect(revisited).toEqual({
      scope: acmeApi,
      issues: [
        { id: "I_api1", number: 1, title: "Crash on start", state: "open" },
      ],
      loading: { status: "loaded" },
    });
    expect(github.requestsFor("acme/api")).toBe(requestsBefore);
  });

  it("says why a repository's issues could not be loaded", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await openUntilLoaded(core, acmeApi)).toEqual({
      scope: acmeApi,
      issues: [],
      loading: {
        status: "failed",
        message:
          "GitHub reported an error: Could not resolve to a Repository with the name 'acme/api'.",
      },
    });
  });

  it("tries a repository that failed again when it is reopened", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github);

    await openUntilLoaded(core, acmeApi);
    github.addRepository("acme/api", [
      { id: "I_api1", number: 1, title: "Crash on start", state: "open" },
    ]);

    expect(await openUntilLoaded(core, acmeApi)).toEqual({
      scope: acmeApi,
      issues: [
        { id: "I_api1", number: 1, title: "Crash on start", state: "open" },
      ],
      loading: { status: "loaded" },
    });
  });

  it("does not load a repository twice when it is reopened mid-load", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { id: "I_api1", number: 1, title: "Crash on start", state: "open" },
    ]);
    github.addRepository("acme/web", [
      { id: "I_web1", number: 1, title: "Broken footer", state: "open" },
    ]);
    const core = createTestCore(github);
    github.pause();

    await core.openList(acmeApi);
    await core.openList(acmeWeb);
    const revisited = openUntilLoaded(core, acmeApi);
    github.resume();

    expect(await revisited).toEqual({
      scope: acmeApi,
      issues: [
        { id: "I_api1", number: 1, title: "Crash on start", state: "open" },
      ],
      loading: { status: "loaded" },
    });
    // Its one page was asked for once.
    expect(github.requestsFor("acme/api")).toBe(1);
  });

  it("keeps issues in memory only", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { id: "I_api1", number: 1, title: "Crash on start", state: "open" },
    ]);
    const core = createTestCore(github);

    await core.getSidebar();
    await openUntilLoaded(core, acmeApi);

    expect(await readdir(home, { recursive: true })).toEqual(["settings.json"]);
  });
});
