import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  Contract,
  RepositoryAddition,
  RepositorySuggestions,
  SidebarEntries,
} from "./contract.ts";
import { createCore } from "./core.ts";
import type { HostEnvironment } from "./directories.ts";
import { createConfigFile } from "./settings/config-file.ts";
import { createLocalStateFile } from "./settings/local-state-file.ts";
import { createSettingsFile } from "./settings/settings-file.ts";
import { testFonts } from "./testing/fonts.ts";
import { testThemes } from "./testing/themes.ts";
import { createFakeGitHub, type FakeGitHub } from "./testing/fake-github.ts";

/** A temporary `VERDANDI_HOME`, so tests never touch the real user data. */
let home: string;
const cores: ReturnType<typeof createCore>[] = [];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "verdandi-picker-"));
});

afterEach(async () => {
  for (const core of cores.splice(0)) core.dispose();
  await rm(home, { recursive: true, force: true });
});

const settingsPath = () => join(home, "settings.json");

/** Writes `settings.json` as the user would, by hand. */
async function writeSettings(settings: unknown) {
  await writeFile(settingsPath(), JSON.stringify(settings));
}

async function readSettings(): Promise<unknown> {
  return JSON.parse(await readFile(settingsPath(), "utf8"));
}

/** A clock that stands still until the test moves it on. */
function createClock() {
  let time = Date.parse("2026-09-28T12:00:00Z");
  return {
    now: () => time,
    advance(milliseconds: number) {
      time += milliseconds;
    },
  };
}

const minute = 60 * 1000;

/**
 * The core on a fake GitHub, on a Linux machine with gh on PATH, with the
 * real settings file and machine-local state below `home`.
 */
function createTestCore(
  github: FakeGitHub,
  { now }: { now?: () => number } = {},
): Contract {
  const files: HostEnvironment = {
    platform: process.platform,
    env: { VERDANDI_HOME: home },
    homedir: join(home, "no-such-home"),
  };
  const core = createCore({
    github: () => github,
    runCommand: (command, args) =>
      Promise.resolve(
        command === "/usr/bin/gh" && args.join(" ") === "--version"
          ? {
              kind: "exited",
              exitCode: 0,
              stdout: "gh version 2.101.0 (2026-09-15)\n",
              stderr: "",
            }
          : { kind: "not-found" },
      ),
    host: {
      platform: "linux",
      env: { PATH: "/usr/bin" },
      homedir: "/home/octo",
    },
    settings: createSettingsFile(files),
    localState: createLocalStateFile(files),
    config: createConfigFile(files, testThemes, testFonts),
    wait: () => Promise.resolve(),
    ...(now ? { now } : {}),
  });
  cores.push(core);
  return core;
}

/**
 * Opens the picker and waits for the suggestions it pushes once they are no
 * longer loading.
 */
async function openUntilSuggested(
  core: Contract,
): Promise<RepositorySuggestions> {
  const settled = nextSuggestions(
    core,
    (suggestions) => suggestions.loading.status !== "loading",
  );
  await core.openRepositoryPicker();
  return settled;
}

/** The next suggestions pushed that satisfy `until`. */
function nextSuggestions(
  core: Contract,
  until: (suggestions: RepositorySuggestions) => boolean = () => true,
): Promise<RepositorySuggestions> {
  return new Promise((resolve) => {
    const unsubscribe = core.on("repositorySuggestionsChanged", (pushed) => {
      if (until(pushed)) {
        unsubscribe();
        resolve(pushed);
      }
    });
  });
}

/**
 * Suggestions as the picker lists them: `owner/name`, with what keeps one
 * from being added or marks it.
 */
function suggestionLines(suggestions: RepositorySuggestions): string[] {
  return suggestions.repositories.map(
    ({ repository, archived, tracked, unavailable }) =>
      [
        `${repository.owner}/${repository.name}`,
        ...(archived ? ["archived"] : []),
        ...(tracked ? ["tracked"] : []),
        ...(unavailable ? [unavailable.kind] : []),
      ].join(" "),
  );
}

/** Additions as `owner/name` asked for, and what became of each. */
function additionLines(additions: RepositoryAddition[]): string[] {
  return additions.map((addition) => {
    const asked = `${addition.asked.owner}/${addition.asked.name}`;
    switch (addition.status) {
      case "added":
        return `${asked} added as ${addition.repository.repository.owner}/${addition.repository.repository.name}`;
      case "unavailable":
        return `${asked} ${addition.repository.unavailable?.kind ?? ""}`;
      case "failed":
        return `${asked} failed: ${addition.problem.kind}`;
    }
  });
}

function sidebarNames(sidebar: SidebarEntries): string[] {
  return sidebar.status === "read"
    ? sidebar.repositories.map(
        ({ repository }) => `${repository.owner}/${repository.name}`,
      )
    : [sidebar.message];
}

/** Waits until a condition holds, checking as time passes. */
async function until(condition: () => boolean) {
  while (!condition()) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

const address = (nameWithOwner: string) => {
  const [owner = "", name = ""] = nameWithOwner.split("/");
  return { owner, name };
};

describe("repository picker: suggestions", () => {
  it("suggests the repositories the account owns, collaborates on or reaches through organizations, with the account and its known organizations as filters", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("octo-reader/dotfiles", [], { suggested: true });
    github.addRepository("acme/api", [], {
      suggested: true,
      organization: true,
    });
    github.addRepository("friend/tool", [], { suggested: true });
    github.addRepository("zeta/lib", [], {
      suggested: true,
      organization: true,
    });
    github.addRepository("cli/cli", []);
    github.setOrganizations(["acme", "beta"]);
    const core = createTestCore(github);

    const suggestions = await openUntilSuggested(core);

    expect(suggestionLines(suggestions)).toEqual([
      "octo-reader/dotfiles",
      "acme/api",
      "friend/tool",
      "zeta/lib",
    ]);
    expect(suggestions.owners).toEqual([
      { login: "octo-reader", kind: "account" },
      { login: "acme", kind: "organization" },
      { login: "beta", kind: "organization" },
      { login: "zeta", kind: "organization" },
    ]);
    expect(suggestions.loading).toEqual({ status: "loaded", capped: false });
    expect(suggestions.restrictions).toEqual([]);
    expect(suggestions.incomplete).toBe(false);
  });

  it("pushes each page of suggestions as it arrives, until all have", async () => {
    const github = createFakeGitHub({
      login: "octo-reader",
      suggestionsPerPage: 2,
    });
    for (const name of ["a", "b", "c", "d", "e"]) {
      github.addRepository(`acme/${name}`, [], { suggested: true });
    }
    const core = createTestCore(github);
    const pushed: RepositorySuggestions[] = [];
    core.on("repositorySuggestionsChanged", (suggestions) => {
      pushed.push(suggestions);
    });

    await openUntilSuggested(core);

    expect(
      pushed.map(
        (suggestions) =>
          `${suggestions.loading.status} ${String(suggestions.repositories.length)}`,
      ),
    ).toEqual(["loading 0", "loading 2", "loading 4", "loaded 5"]);
    expect(github.received).toEqual([
      "fetchRepositorySuggestions ",
      "fetchRepositorySuggestions after 2",
      "fetchRepositorySuggestions after 4",
    ]);
  });

  it("suggests at most 1,000 repositories, and says there are more", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    for (let index = 0; index < 1001; index++) {
      github.addRepository(`acme/repo-${String(index)}`, [], {
        suggested: true,
      });
    }
    const core = createTestCore(github);

    const suggestions = await openUntilSuggested(core);

    expect(suggestions.repositories).toHaveLength(1000);
    expect(suggestions.loading).toEqual({ status: "loaded", capped: true });
    expect(github.received).toHaveLength(10);
  });

  it("finds no suggestions as a loaded, empty list, keeping direct entry open", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("cli/cli", []);
    const core = createTestCore(github);

    const suggestions = await openUntilSuggested(core);

    expect(suggestions).toEqual({
      owners: [{ login: "octo-reader", kind: "account" }],
      repositories: [],
      loading: { status: "loaded", capped: false },
      restrictions: [],
      incomplete: false,
    });
    expect(await core.checkRepository(address("cli/cli"))).toMatchObject({
      status: "found",
    });
  });

  it("reports suggestions that could not be read as a failure, never as an empty list", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [], { suggested: true });
    github.failNextWith({ kind: "gh-failed", message: "connection refused" });
    const core = createTestCore(github);

    const suggestions = await openUntilSuggested(core);

    expect(suggestions.repositories).toEqual([]);
    expect(suggestions.loading).toEqual({
      status: "failed",
      problem: { kind: "unreachable", message: "connection refused" },
    });
  });

  it("keeps the suggestions that arrived before a later page failed", async () => {
    const github = createFakeGitHub({
      login: "octo-reader",
      suggestionsPerPage: 1,
    });
    github.addRepository("acme/api", [], { suggested: true });
    github.addRepository("acme/web", [], { suggested: true });
    const core = createTestCore(github);
    const firstPage = nextSuggestions(
      core,
      (suggestions) => suggestions.repositories.length === 1,
    );
    const settled = nextSuggestions(
      core,
      (suggestions) => suggestions.loading.status !== "loading",
    );
    github.pause("fetchRepositorySuggestions");
    await core.openRepositoryPicker();
    await until(() => github.requestsInFlight === 1);
    github.failNextWith({ kind: "gh-failed", message: "connection reset" });
    github.resume();
    await firstPage;

    const suggestions = await settled;

    expect(suggestionLines(suggestions)).toEqual(["acme/api"]);
    expect(suggestions.loading).toMatchObject({ status: "failed" });
  });

  it("reads failed suggestions anew when the picker opens again", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [], { suggested: true });
    github.failNextWith({ kind: "gh-failed", message: "connection refused" });
    const core = createTestCore(github);
    await openUntilSuggested(core);
    await core.closeRepositoryPicker();

    const suggestions = await openUntilSuggested(core);

    expect(suggestionLines(suggestions)).toEqual(["acme/api"]);
    expect(suggestions.loading).toEqual({ status: "loaded", capped: false });
  });

  it("explains the repositories GitHub left out for an organization's SSO", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    const sso = {
      kind: "sso" as const,
      message:
        "Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.",
      url: "https://github.com/orgs/acme/sso?authorization_request=abc",
    };
    github.addRepository("acme/api", [], { suggested: true });
    github.addRepository("acme/web", [], { suggested: true });
    github.addRepository("octo-reader/notes", [], { suggested: true });
    github.hide("acme/api", sso);
    github.hide("acme/web", sso);
    const core = createTestCore(github);

    const suggestions = await openUntilSuggested(core);

    expect(suggestionLines(suggestions)).toEqual(["octo-reader/notes"]);
    expect(suggestions.restrictions).toEqual([sso]);
    expect(suggestions.incomplete).toBe(true);
    expect(suggestions.loading).toEqual({ status: "loaded", capped: false });
  });

  it("says GitHub left out suggestions it reported errors about, even without saying why", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [], { suggested: true });
    github.addRepository("acme/web", [], { suggested: true });
    github.hide("acme/api");
    const core = createTestCore(github);

    const suggestions = await openUntilSuggested(core);

    expect(suggestionLines(suggestions)).toEqual(["acme/web"]);
    expect(suggestions.restrictions).toEqual([]);
    expect(suggestions.incomplete).toBe(true);
    expect(suggestions.loading).toEqual({ status: "loaded", capped: false });
  });

  it("marks repositories with Issues turned off or without issue access as unavailable, and allows archived ones", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [], { suggested: true });
    github.addRepository("acme/docs", [], {
      suggested: true,
      hasIssuesEnabled: false,
    });
    github.addRepository("acme/secret", [], {
      suggested: true,
      issuesDenied: true,
    });
    github.addRepository("acme/legacy", [], {
      suggested: true,
      isArchived: true,
    });
    const core = createTestCore(github);

    const suggestions = await openUntilSuggested(core);

    expect(suggestionLines(suggestions)).toEqual([
      "acme/api",
      "acme/docs issues-disabled",
      "acme/secret no-issue-access",
      "acme/legacy archived",
    ]);
  });

  it("marks tracked repositories, also those tracked under an earlier name", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [], { suggested: true });
    github.addRepository("acme/old-web", [], { suggested: true });
    github.addRepository("acme/tools", [], { suggested: true });
    await writeSettings({
      version: 1,
      repositories: [
        { name: "Acme/API" },
        { name: "acme/old-web", id: github.repositoryId("acme/old-web") },
      ],
    });
    github.renameRepository("acme/old-web", "acme/web");
    const core = createTestCore(github);

    const suggestions = await openUntilSuggested(core);

    expect(suggestionLines(suggestions)).toEqual([
      "acme/api tracked",
      "acme/web tracked",
      "acme/tools",
    ]);
  });

  it("shows suggestions read in the last five minutes again without asking GitHub, and reads older ones anew", async () => {
    const clock = createClock();
    const github = createFakeGitHub({ login: "octo-reader", now: clock.now });
    github.addRepository("acme/api", [], { suggested: true });
    const core = createTestCore(github, { now: clock.now });
    await openUntilSuggested(core);
    await core.closeRepositoryPicker();
    github.addRepository("acme/web", [], { suggested: true });

    clock.advance(4 * minute);
    const recent = await openUntilSuggested(core);
    await core.closeRepositoryPicker();
    clock.advance(2 * minute);
    const reread = await openUntilSuggested(core);

    expect(suggestionLines(recent)).toEqual(["acme/api"]);
    expect(suggestionLines(reread)).toEqual(["acme/api", "acme/web"]);
    expect(github.received).toEqual([
      "fetchRepositorySuggestions ",
      "fetchRepositorySuggestions ",
    ]);
  });

  it("asks for no more pages once the picker is closed", async () => {
    const github = createFakeGitHub({
      login: "octo-reader",
      suggestionsPerPage: 1,
    });
    github.addRepository("acme/api", [], { suggested: true });
    github.addRepository("acme/web", [], { suggested: true });
    const core = createTestCore(github);
    github.pause("fetchRepositorySuggestions");
    await core.openRepositoryPicker();
    await until(() => github.requestsInFlight === 1);
    await core.closeRepositoryPicker();
    github.resume();
    await until(() => github.requestsInFlight === 0);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(github.received).toEqual(["fetchRepositorySuggestions "]);
  });

  it("reads the suggestions anew as another account when the account changes while the picker is open", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [], { suggested: true });
    const core = createTestCore(github);
    await openUntilSuggested(core);
    const reread = nextSuggestions(
      core,
      (suggestions) =>
        suggestions.owners[0]?.login === "octo-other" &&
        suggestions.loading.status !== "loading",
    );

    github.signInAs("octo-other");
    await core.checkRepository(address("acme/api"));

    expect((await reread).owners).toEqual([
      { login: "octo-other", kind: "account" },
    ]);
  });
});

describe("repository picker: checking a repository by its address", () => {
  it("checks a repository that is not suggested", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("cli/cli", [], { organization: true });
    const core = createTestCore(github);

    expect(await core.checkRepository(address("cli/cli"))).toEqual({
      status: "found",
      repository: {
        id: github.repositoryId("cli/cli"),
        repository: { owner: "cli", name: "cli" },
        archived: false,
        tracked: false,
        unavailable: undefined,
      },
    });
    expect(github.received).toEqual(["fetchRepositoryAccess cli/cli"]);
  });

  it("follows a renamed repository to its current address", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/old", []);
    github.renameRepository("acme/old", "acme/new");
    const core = createTestCore(github);

    expect(await core.checkRepository(address("acme/old"))).toMatchObject({
      status: "found",
      repository: { repository: { owner: "acme", name: "new" } },
    });
  });

  it("says why a repository cannot be added: Issues turned off, or no access to its issues", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/docs", [], { hasIssuesEnabled: false });
    github.addRepository("acme/secret", [], { issuesDenied: true });
    const core = createTestCore(github);

    expect(await core.checkRepository(address("acme/docs"))).toMatchObject({
      status: "found",
      repository: { unavailable: { kind: "issues-disabled" } },
    });
    expect(await core.checkRepository(address("acme/secret"))).toMatchObject({
      status: "found",
      repository: {
        unavailable: { kind: "no-issue-access", access: undefined },
      },
    });
  });

  it("reports a repository GitHub will not show as unavailable, naming why only when GitHub does", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    const approval = {
      kind: "organization-approval" as const,
      message:
        "Although you appear to have the correct authorization credentials, the `acme` organization has enabled OAuth App access restrictions.",
    };
    github.addRepository("acme/restricted", []);
    github.hide("acme/restricted", approval);
    const core = createTestCore(github);

    expect(await core.checkRepository(address("acme/missing"))).toEqual({
      status: "failed",
      problem: { kind: "unavailable", access: undefined },
    });
    expect(await core.checkRepository(address("acme/restricted"))).toEqual({
      status: "failed",
      problem: { kind: "unavailable", access: approval },
    });
  });

  it("reports failing to reach GitHub as a failure", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    github.failNextWith({ kind: "gh-failed", message: "connection refused" });
    const core = createTestCore(github);

    expect(await core.checkRepository(address("acme/api"))).toEqual({
      status: "failed",
      problem: { kind: "unreachable", message: "connection refused" },
    });
  });

  it("marks a repository tracked under an earlier name as tracked", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/old", []);
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/old", id: github.repositoryId("acme/old") }],
    });
    github.renameRepository("acme/old", "acme/new");
    const core = createTestCore(github);

    expect(await core.checkRepository(address("acme/new"))).toMatchObject({
      status: "found",
      repository: { tracked: true },
    });
  });
});

describe("repository picker: adding repositories", () => {
  it("adds repositories to the end of the Repositories section with their IDs, checking all of them in one request", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    github.addRepository("acme/web", []);
    github.addRepository("cli/cli", []);
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api" }],
      views: [{ id: "bugs", name: "Bugs", query: "is:open label:bug" }],
    });
    const core = createTestCore(github);
    await core.getSidebar();
    const sidebar = new Promise<SidebarEntries>((resolve) => {
      const unsubscribe = core.on("sidebarChanged", (pushed) => {
        if (sidebarNames(pushed).length === 3) {
          unsubscribe();
          resolve(pushed);
        }
      });
    });

    const additions = await core.addRepositories([
      address("cli/cli"),
      address("acme/web"),
    ]);

    expect(additionLines(additions)).toEqual([
      "cli/cli added as cli/cli",
      "acme/web added as acme/web",
    ]);
    expect(await readSettings()).toEqual({
      version: 1,
      repositories: [
        { name: "acme/api" },
        { name: "cli/cli", id: github.repositoryId("cli/cli") },
        { name: "acme/web", id: github.repositoryId("acme/web") },
      ],
      views: [{ id: "bugs", name: "Bugs", query: "is:open label:bug" }],
    });
    expect(sidebarNames(await sidebar)).toEqual([
      "acme/api",
      "cli/cli",
      "acme/web",
    ]);
    expect(
      github.received.filter((read) =>
        read.startsWith("fetchRepositoryAccess"),
      ),
    ).toEqual(["fetchRepositoryAccess cli/cli acme/web"]);
  });

  it("adds the repositories whose issues can be read and reports each other one with why, taking nothing back", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    github.addRepository("acme/docs", [], { hasIssuesEnabled: false });
    github.addRepository("acme/secret", [], { issuesDenied: true });
    github.addRepository("acme/web", []);
    const core = createTestCore(github);

    const additions = await core.addRepositories([
      address("acme/api"),
      address("acme/docs"),
      address("acme/secret"),
      address("acme/missing"),
      address("acme/web"),
    ]);

    expect(additionLines(additions)).toEqual([
      "acme/api added as acme/api",
      "acme/docs issues-disabled",
      "acme/secret no-issue-access",
      "acme/missing failed: unavailable",
      "acme/web added as acme/web",
    ]);
    expect(await readSettings()).toMatchObject({
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    });
  });

  it("adds archived repositories and repositories without issues", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/legacy", [{ number: 1, title: "Old" }], {
      isArchived: true,
    });
    github.addRepository("acme/new", []);
    const core = createTestCore(github);

    const additions = await core.addRepositories([
      address("acme/legacy"),
      address("acme/new"),
    ]);

    expect(additionLines(additions)).toEqual([
      "acme/legacy added as acme/legacy",
      "acme/new added as acme/new",
    ]);
    expect(additions[0]).toMatchObject({
      repository: { archived: true, tracked: true },
    });
  });

  it("checks each repository afresh, whatever the suggestions said", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [], { suggested: true });
    const core = createTestCore(github);
    await openUntilSuggested(core);
    github.addRepository("acme/api", [], {
      suggested: true,
      hasIssuesEnabled: false,
    });

    const additions = await core.addRepositories([address("acme/api")]);

    expect(additionLines(additions)).toEqual(["acme/api issues-disabled"]);
  });

  it("adds a renamed repository under its current name", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/old", []);
    github.renameRepository("acme/old", "acme/new");
    const core = createTestCore(github);

    const additions = await core.addRepositories([address("acme/old")]);

    expect(additionLines(additions)).toEqual(["acme/old added as acme/new"]);
    expect(await readSettings()).toMatchObject({
      repositories: [{ name: "acme/new", id: github.repositoryId("acme/new") }],
    });
  });

  it("updates an entry tracked under an earlier name in place, rather than adding it twice", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/old", []);
    const id = github.repositoryId("acme/old");
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/old", id }, { name: "acme/tools" }],
    });
    github.renameRepository("acme/old", "acme/new");
    const core = createTestCore(github);

    const additions = await core.addRepositories([address("acme/new")]);

    expect(additionLines(additions)).toEqual(["acme/new added as acme/new"]);
    expect(await readSettings()).toMatchObject({
      repositories: [{ name: "acme/new", id }, { name: "acme/tools" }],
    });
  });

  it("adds a repository asked for twice, or under two names, once", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/old", []);
    github.renameRepository("acme/old", "acme/new");
    const core = createTestCore(github);

    await core.addRepositories([
      address("acme/old"),
      address("acme/new"),
      address("Acme/New"),
    ]);

    expect(await readSettings()).toMatchObject({
      repositories: [{ name: "acme/new" }],
    });
  });

  it("adds nothing while the settings file cannot be changed, saying why", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    await writeFile(settingsPath(), "{ not json");
    const core = createTestCore(github);

    const additions = await core.addRepositories([address("acme/api")]);

    expect(additions).toEqual([
      {
        asked: { owner: "acme", name: "api" },
        status: "failed",
        problem: {
          kind: "error",
          message: expect.stringContaining("not valid JSON") as unknown,
        },
      },
    ]);
    expect(await readFile(settingsPath(), "utf8")).toBe("{ not json");
  });

  it("reports every repository as failed when GitHub cannot be reached", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    github.failNextWith({ kind: "gh-failed", message: "connection refused" });
    const core = createTestCore(github);

    const additions = await core.addRepositories([address("acme/api")]);

    expect(additionLines(additions)).toEqual(["acme/api failed: unreachable"]);
    expect(await readdir(home)).not.toContain("settings.json");
  });

  it("pushes the open picker's suggestions with the added repositories tracked", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [], { suggested: true });
    github.addRepository("acme/web", [], { suggested: true });
    const core = createTestCore(github);
    await openUntilSuggested(core);
    const pushed = nextSuggestions(core, (suggestions) =>
      suggestions.repositories.some(({ tracked }) => tracked),
    );

    await core.addRepositories([address("acme/web")]);

    expect(suggestionLines(await pushed)).toEqual([
      "acme/api",
      "acme/web tracked",
    ]);
  });
});

describe("repository picker: first launch", () => {
  it("is the first launch while there is no settings file", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await core.getSidebar()).toMatchObject({
      status: "read",
      firstLaunch: true,
    });
  });

  it("is not the first launch once a settings file exists, however empty or broken", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));
    await writeSettings({ version: 1 });
    expect(await core.getSidebar()).toMatchObject({ firstLaunch: false });

    await writeFile(settingsPath(), "{ not json");
    expect(await core.getSidebar()).toMatchObject({ firstLaunch: false });
  });

  it("Skip writes an empty settings file, so the picker does not open on its own again", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));
    await core.getSidebar();

    expect(await core.skipRepositoryPicker()).toEqual({ ok: true });

    expect(await readSettings()).toEqual({
      version: 1,
      repositories: [],
      views: [],
    });
    expect(await core.getSidebar()).toMatchObject({ firstLaunch: false });
  });

  it("Skip leaves an existing settings file as it is", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));
    const text = JSON.stringify({
      version: 1,
      repositories: [{ name: "acme/api" }],
    });
    await writeFile(settingsPath(), text);

    expect(await core.skipRepositoryPicker()).toEqual({ ok: true });

    expect(await readFile(settingsPath(), "utf8")).toBe(text);
  });

  it("adding a repository on first launch creates the settings file", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    const core = createTestCore(github);
    await core.getSidebar();

    await core.addRepositories([address("acme/api")]);

    expect(await readSettings()).toEqual({
      version: 1,
      repositories: [{ name: "acme/api", id: github.repositoryId("acme/api") }],
      views: [],
    });
    expect(await core.getSidebar()).toMatchObject({ firstLaunch: false });
  });
});
