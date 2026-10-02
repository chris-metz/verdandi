import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  Contract,
  IssueList,
  Notice,
  Scope,
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
  home = await mkdtemp(join(tmpdir(), "verdandi-identity-"));
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

/**
 * The core on a fake GitHub, on a Linux machine with gh on PATH, with the
 * real settings file and machine-local state below `home`.
 */
function createTestCore(github: FakeGitHub): Contract {
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
  });
  cores.push(core);
  return core;
}

/** Everything the core pushes from now on, as it pushes it. */
function watch(core: Contract) {
  const pushed = {
    notices: [] as Notice[],
    sidebar: undefined as SidebarEntries | undefined,
    lists: [] as IssueList[],
  };
  core.on("notice", (notice) => pushed.notices.push(notice));
  core.on("sidebarChanged", (sidebar) => {
    pushed.sidebar = sidebar;
  });
  core.on("listChanged", (list) => pushed.lists.push(list));
  return pushed;
}

/**
 * The sidebar's tracked repositories as a user reads them: `owner/name`, the
 * open-issue count ("–" while it is unknown), and why it is unavailable.
 */
function sidebarLines(sidebar: SidebarEntries | undefined): string[] {
  if (sidebar?.status !== "read") return [];
  return sidebar.repositories.map(({ repository, openIssues, unavailable }) =>
    [
      `${repository.owner}/${repository.name}`,
      openIssues.status === "known" ? String(openIssues.count) : "–",
      ...(unavailable?.nameTakenOver
        ? ["name taken over"]
        : unavailable
          ? ["unavailable"]
          : []),
    ].join(" "),
  );
}

/** The latest list pushed for a scope, if any. */
function latestList(lists: IssueList[], scope: Scope): IssueList | undefined {
  return lists.findLast((list) => isDeepStrictEqual(list.scope, scope));
}

/** Waits until a condition holds, checking as time passes. */
async function until(condition: () => boolean) {
  for (let tries = 0; !condition(); tries++) {
    if (tries > 2000) throw new Error("The condition never held.");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

const address = (nameWithOwner: string) => {
  const [owner = "", name = ""] = nameWithOwner.split("/");
  return { owner, name };
};

describe("repository identity: renames and transfers", () => {
  it("follows a rename found by the startup count, storing the new name and saying so", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "An issue" }]);
    github.addRepository("acme/web", []);
    const id = github.repositoryId("acme/api");
    await writeSettings({
      version: 1,
      repositories: [
        { name: "acme/api", id },
        { name: "acme/web", id: github.repositoryId("acme/web") },
      ],
    });
    github.renameRepository("acme/api", "newco/api");
    const core = createTestCore(github);
    const pushed = watch(core);

    await core.getSidebar();
    await until(() => sidebarLines(pushed.sidebar)[0] === "newco/api 1");

    expect(sidebarLines(pushed.sidebar)).toEqual(["newco/api 1", "acme/web 0"]);
    expect(pushed.notices).toEqual([
      {
        kind: "repositories-renamed",
        renamed: [
          { from: address("acme/api"), to: address("newco/api"), views: [] },
        ],
      },
    ]);
    expect(await readSettings()).toMatchObject({
      repositories: [{ name: "newco/api", id }, { name: "acme/web" }],
    });
    // The count GitHub answered under the old name is the new name's.
    expect(github.received).toEqual([
      "fetchRepositorySummaries acme/api acme/web",
    ]);
  });
  it("says so once for several renames found at once, and corrects a name's case silently", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    github.addRepository("acme/web", []);
    github.addRepository("acme/tools", []);
    await writeSettings({
      version: 1,
      repositories: [
        { name: "acme/api", id: github.repositoryId("acme/api") },
        { name: "Acme/Tools", id: github.repositoryId("acme/tools") },
        { name: "acme/web", id: github.repositoryId("acme/web") },
      ],
    });
    github.renameRepository("acme/api", "newco/api");
    github.renameRepository("acme/web", "acme/website");
    const core = createTestCore(github);
    const pushed = watch(core);

    await core.getSidebar();
    await until(() => sidebarLines(pushed.sidebar)[2] === "acme/website 0");

    expect(sidebarLines(pushed.sidebar)).toEqual([
      "newco/api 0",
      "acme/tools 0",
      "acme/website 0",
    ]);
    expect(pushed.notices).toEqual([
      {
        kind: "repositories-renamed",
        renamed: [
          { from: address("acme/api"), to: address("newco/api"), views: [] },
          { from: address("acme/web"), to: address("acme/website"), views: [] },
        ],
      },
    ]);
    expect(await readSettings()).toMatchObject({
      repositories: [
        { name: "newco/api" },
        { name: "acme/tools" },
        { name: "acme/website" },
      ],
    });
  });

  it("names the views whose search still names the old address, without changing them", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    const views = [
      { id: "bugs", name: "Bugs", query: "is:open repo:acme/api label:bug" },
      {
        id: "mine",
        name: "Mine",
        query: "(REPO:Acme/API OR repo:x/y) is:open",
      },
      { id: "v2", name: "API v2", query: "repo:acme/api-v2" },
      { id: "org", name: "Org", query: "org:acme is:open" },
      { id: "not", name: "Not API", query: "org:acme -repo:acme/api" },
    ];
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api", id: github.repositoryId("acme/api") }],
      views,
    });
    github.renameRepository("acme/api", "newco/api");
    const core = createTestCore(github);
    const pushed = watch(core);

    await core.getSidebar();
    await until(() => pushed.notices.length > 0);

    expect(pushed.notices).toEqual([
      {
        kind: "repositories-renamed",
        renamed: [
          {
            from: address("acme/api"),
            to: address("newco/api"),
            views: [views[0], views[1], views[4]],
          },
        ],
      },
    ]);
    expect(await readSettings()).toMatchObject({ views });
  });

  it("stores the ID of a repository tracked without one once GitHub follows its name elsewhere", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    github.renameRepository("acme/api", "newco/api");
    const core = createTestCore(github);
    const pushed = watch(core);

    await core.getSidebar();
    await until(() => sidebarLines(pushed.sidebar)[0] === "newco/api 0");

    expect(await readSettings()).toMatchObject({
      repositories: [
        { name: "newco/api", id: github.repositoryId("newco/api") },
      ],
    });
    expect(pushed.notices).toMatchObject([{ kind: "repositories-renamed" }]);
  });
  it("keeps a repository renamed during a session the same entry, its list keeping what it read, its expansion and its label filter", async () => {
    const bug = { name: "bug", color: "d73a4a" };
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Parent", subIssues: ["acme/api#2"] },
      { number: 2, title: "Sub-issue", labels: [bug] },
    ]);
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api", id: github.repositoryId("acme/api") }],
    });
    const core = createTestCore(github);
    const pushed = watch(core);
    await core.getSidebar();
    await until(() => sidebarLines(pushed.sidebar)[0] === "acme/api 2");
    const old: Scope = { kind: "repository", repository: address("acme/api") };
    await core.openList(old);
    await until(
      () => latestList(pushed.lists, old)?.loading.status === "current",
    );
    await core.setExpanded(old, "I_acme/api#1", false);
    await core.addLabelToFilter(old, bug);

    github.renameRepository("acme/api", "newco/api");
    await core.refresh(undefined);
    await until(() => sidebarLines(pushed.sidebar)[0] === "newco/api 2");
    const renamed: Scope = {
      kind: "repository",
      repository: address("newco/api"),
    };
    const received = github.received.length;
    await core.openList(renamed);
    const list = latestList(pushed.lists, renamed);

    expect(list?.loading.status).toBe("current");
    expect(
      list?.trees.map(({ issue, expanded }) => [
        issue.title,
        issue.external,
        expanded,
      ]),
    ).toEqual([["Parent", false, false]]);
    expect(list?.labelFilter).toEqual([bug]);
    expect(github.received.slice(received)).toEqual([]);
  });

  it("keeps the issues of a repository renamed during a session tracked in All", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [
      { number: 1, title: "Parent", subIssues: ["acme/web#1"] },
    ]);
    github.addRepository("acme/web", [{ number: 1, title: "Sub-issue" }]);
    await writeSettings({
      version: 1,
      repositories: [
        { name: "acme/api", id: github.repositoryId("acme/api") },
        { name: "acme/web", id: github.repositoryId("acme/web") },
      ],
    });
    const core = createTestCore(github);
    const pushed = watch(core);
    await core.getSidebar();
    const all: Scope = { kind: "all" };
    await core.openList(all);
    await until(
      () => latestList(pushed.lists, all)?.loading.status === "current",
    );

    github.renameRepository("acme/web", "newco/web");
    await core.refresh(undefined);
    await until(() => sidebarLines(pushed.sidebar)[1] === "newco/web 1");
    await core.openList(all);
    const list = latestList(pushed.lists, all);

    const [parent] = list?.trees ?? [];
    expect(
      parent?.subIssues.map(({ issue }) => [issue.title, issue.external]),
    ).toEqual([["Sub-issue", false]]);
  });
});

describe("repository identity: names taken over and gone", () => {
  it("follows a repository by its ID when another repository took over its old name", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Tracked" }]);
    const id = github.repositoryId("acme/api");
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api", id }],
    });
    github.renameRepository("acme/api", "newco/api");
    github.addRepository("acme/api", [
      { number: 1, title: "Another" },
      { number: 2, title: "Another" },
    ]);
    const core = createTestCore(github);
    const pushed = watch(core);

    await core.getSidebar();
    await until(() => sidebarLines(pushed.sidebar)[0] === "newco/api 1");

    expect(await readSettings()).toMatchObject({
      repositories: [{ name: "newco/api", id }],
    });
    expect(pushed.notices).toMatchObject([
      {
        kind: "repositories-renamed",
        renamed: [{ from: address("acme/api"), to: address("newco/api") }],
      },
    ]);
    expect(github.received).toContain(`fetchRepositoryById ${String(id)}`);
  });

  it("never shows the repository that took over a name for the one tracked, which is unavailable when its ID cannot be read", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Tracked" }]);
    const id = github.repositoryId("acme/api");
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api", id }],
    });
    github.renameRepository("acme/api", "newco/api");
    github.hide("newco/api");
    github.addRepository("acme/api", [{ number: 7, title: "Another" }]);
    const core = createTestCore(github);
    const pushed = watch(core);
    const scope: Scope = {
      kind: "repository",
      repository: address("acme/api"),
    };

    await core.getSidebar();
    await until(
      () => sidebarLines(pushed.sidebar)[0] === "acme/api – name taken over",
    );
    await core.openList(scope);
    await until(
      () => latestList(pushed.lists, scope)?.loading.status === "failed",
    );

    expect(latestList(pushed.lists, scope)).toMatchObject({
      trees: [],
      loading: {
        status: "failed",
        problem: { kind: "unavailable", nameTakenOver: true },
      },
    });
    expect(sidebarLines(pushed.sidebar)).toEqual([
      "acme/api – name taken over",
    ]);
    expect(await readSettings()).toMatchObject({
      repositories: [{ name: "acme/api", id }],
    });
    expect(pushed.notices).toEqual([]);
  });

  it("never shows the repository that took over a name, even while the one tracked is looked up by its ID", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "Tracked" }]);
    const id = github.repositoryId("acme/api");
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api", id }],
    });
    github.renameRepository("acme/api", "newco/api");
    github.hide("newco/api");
    github.addRepository("acme/api", [{ number: 7, title: "Another" }]);
    const core = createTestCore(github);
    const pushed = watch(core);
    const scope: Scope = {
      kind: "repository",
      repository: address("acme/api"),
    };
    github.pause("fetchRepositoryById");
    await core.getSidebar();
    await until(() => github.requestsInFlight === 1);

    await core.openList(scope);
    await until(
      () => latestList(pushed.lists, scope)?.loading.status === "failed",
    );
    const whileLookingUp = sidebarLines(pushed.sidebar);
    github.resume();
    await until(() => github.requestsInFlight === 0);

    expect(whileLookingUp).toEqual(["acme/api – name taken over"]);
    expect(sidebarLines(pushed.sidebar)).toEqual([
      "acme/api – name taken over",
    ]);
    expect(latestList(pushed.lists, scope)).toMatchObject({
      trees: [],
      loading: { status: "failed", problem: { nameTakenOver: true } },
    });
  });

  it("stays unavailable, never counting the other repository, when looking up its ID fails for now", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    const id = github.repositoryId("acme/api");
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api", id }],
    });
    github.renameRepository("acme/api", "newco/api");
    github.addRepository("acme/api", [{ number: 7, title: "Another" }]);
    const core = createTestCore(github);
    const pushed = watch(core);
    github.pause("fetchRepositorySummaries");
    await core.getSidebar();
    await until(() => github.requestsInFlight === 1);
    // GitHub cannot be reached as the ID is looked up.
    github.failNextWith({ kind: "gh-failed", message: "offline" });

    github.resume();
    await until(
      () => github.received.length >= 2 && github.requestsInFlight === 0,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(github.received[1]).toBe(`fetchRepositoryById ${String(id)}`);
    expect(sidebarLines(pushed.sidebar)).toEqual([
      "acme/api – name taken over",
    ]);
    await core.retry(undefined);
    await until(() => sidebarLines(pushed.sidebar)[0] === "newco/api 0");
  });

  it("looks up a repository whose name GitHub no longer knows by its ID, once per count", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    const id = github.repositoryId("acme/api");
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api", id }],
    });
    github.renameRepository("acme/api", "newco/api", { redirect: false });
    const core = createTestCore(github);
    const pushed = watch(core);

    await core.getSidebar();
    await until(() => sidebarLines(pushed.sidebar)[0] === "newco/api 0");

    expect(github.received).toEqual([
      "fetchRepositorySummaries acme/api",
      `fetchRepositoryById ${String(id)}`,
      "fetchRepositorySummaries newco/api",
    ]);
    expect(pushed.notices).toMatchObject([{ kind: "repositories-renamed" }]);
  });

  it("says so once for renames found by name and by ID in the same count", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    github.addRepository("acme/web", []);
    await writeSettings({
      version: 1,
      repositories: [
        { name: "acme/api", id: github.repositoryId("acme/api") },
        { name: "acme/web", id: github.repositoryId("acme/web") },
      ],
    });
    github.renameRepository("acme/api", "newco/api", { redirect: false });
    github.renameRepository("acme/web", "newco/web");
    const core = createTestCore(github);
    const pushed = watch(core);

    await core.getSidebar();
    await until(() => pushed.notices.length > 0);

    expect(pushed.notices).toEqual([
      {
        kind: "repositories-renamed",
        renamed: [
          { from: address("acme/web"), to: address("newco/web"), views: [] },
          { from: address("acme/api"), to: address("newco/api"), views: [] },
        ],
      },
    ]);
  });

  it("marks a repository unavailable as any other when neither its name nor its ID can be read", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    github.addRepository("acme/web", []);
    await writeSettings({
      version: 1,
      repositories: [
        { name: "acme/api", id: github.repositoryId("acme/api") },
        { name: "acme/web" },
      ],
    });
    github.hide("acme/api");
    github.hide("acme/web");
    const core = createTestCore(github);
    const pushed = watch(core);

    await core.getSidebar();
    await until(
      () =>
        sidebarLines(pushed.sidebar).join() ===
        "acme/api – unavailable,acme/web – unavailable",
    );
    await core.retry(undefined);
    await until(
      () => github.requestsInFlight === 0 && github.received.length === 4,
    );

    expect(sidebarLines(pushed.sidebar)).toEqual([
      "acme/api – unavailable",
      "acme/web – unavailable",
    ]);
    // Without an ID stored, nothing is looked up.
    expect(github.received).toEqual([
      "fetchRepositorySummaries acme/api acme/web",
      `fetchRepositoryById ${String(github.repositoryId("acme/api"))}`,
      "fetchRepositorySummaries acme/api acme/web",
      `fetchRepositoryById ${String(github.repositoryId("acme/api"))}`,
    ]);
  });
  it("tracks the repository that took over a name in place of the one tracked: new ID, same position", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    github.addRepository("acme/web", []);
    const id = github.repositoryId("acme/api");
    await writeSettings({
      version: 1,
      repositories: [
        { name: "acme/api", id },
        { name: "acme/web", id: github.repositoryId("acme/web") },
      ],
    });
    github.renameRepository("acme/api", "newco/api");
    github.hide("newco/api");
    github.addRepository("acme/api", [{ number: 7, title: "Another" }]);
    const core = createTestCore(github);
    const pushed = watch(core);
    await core.getSidebar();
    await until(
      () => sidebarLines(pushed.sidebar)[0] === "acme/api – name taken over",
    );

    const replaced = await core.replaceRepository({
      ...address("acme/api"),
      id,
    });
    await until(() => sidebarLines(pushed.sidebar)[0] === "acme/api 1");

    expect(replaced).toMatchObject({
      asked: address("acme/api"),
      status: "added",
      repository: { id: github.repositoryId("acme/api") },
    });
    expect(sidebarLines(pushed.sidebar)).toEqual(["acme/api 1", "acme/web 0"]);
    expect(await readSettings()).toMatchObject({
      repositories: [
        { name: "acme/api", id: github.repositoryId("acme/api") },
        { name: "acme/web" },
      ],
    });
  });
});

describe("repository identity: duplicates", () => {
  it("keeps the higher of two entries with the same ID, removes the other from settings.json, and says so once", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "An issue" }]);
    github.addRepository("acme/web", []);
    const id = github.repositoryId("acme/api");
    await writeSettings({
      version: 1,
      repositories: [
        { name: "acme/api", id },
        { name: "acme/web", id: github.repositoryId("acme/web") },
        { name: "newco/api", id },
      ],
    });
    const core = createTestCore(github);
    const pushed = watch(core);

    const sidebar = await core.getSidebar();
    await until(() => pushed.notices.length > 0);
    await core.getSidebar();
    await until(() => sidebarLines(pushed.sidebar)[0] === "acme/api 1");

    expect(sidebarLines(sidebar)).toEqual(["acme/api –", "acme/web –"]);
    expect(pushed.notices).toEqual([
      {
        kind: "duplicate-repositories-removed",
        removed: [
          { repository: address("newco/api"), sameAs: address("acme/api") },
        ],
      },
    ]);
    expect(await readSettings()).toEqual({
      version: 1,
      repositories: [
        { name: "acme/api", id },
        { name: "acme/web", id: github.repositoryId("acme/web") },
      ],
      views: [],
    });
  });
  it("updates the entry of a repository added under its new name in place, available again, and says so", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", [{ number: 1, title: "An issue" }]);
    github.addRepository("acme/web", []);
    const id = github.repositoryId("acme/api");
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api", id }, { name: "acme/web" }],
    });
    github.renameRepository("acme/api", "newco/api", { redirect: false });
    // Its ID cannot be read either, e.g. while an organization's SSO blocks it.
    github.hide("newco/api");
    const core = createTestCore(github);
    const pushed = watch(core);
    await core.getSidebar();
    await until(
      () => sidebarLines(pushed.sidebar)[0] === "acme/api – unavailable",
    );
    github.reveal("newco/api");

    const additions = await core.addRepositories([address("newco/api")]);
    await until(() => sidebarLines(pushed.sidebar)[0] === "newco/api 1");

    expect(additions).toMatchObject([{ status: "added" }]);
    expect(sidebarLines(pushed.sidebar)).toEqual(["newco/api 1", "acme/web 0"]);
    expect(pushed.notices).toEqual([
      {
        kind: "repositories-renamed",
        renamed: [
          { from: address("acme/api"), to: address("newco/api"), views: [] },
        ],
      },
    ]);
    expect(await readSettings()).toMatchObject({
      repositories: [{ name: "newco/api", id }, { name: "acme/web" }],
    });
  });

  it("adds a repository as its own entry at the end when the unavailable entry it was tracked as has no ID", async () => {
    const github = createFakeGitHub({ login: "octo-reader" });
    github.addRepository("acme/api", []);
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    github.renameRepository("acme/api", "newco/api", { redirect: false });
    const core = createTestCore(github);
    const pushed = watch(core);

    await core.addRepositories([address("newco/api")]);

    expect(await readSettings()).toMatchObject({
      repositories: [
        { name: "acme/api" },
        { name: "newco/api", id: github.repositoryId("newco/api") },
      ],
    });
    expect(pushed.notices).toEqual([]);
  });
});
