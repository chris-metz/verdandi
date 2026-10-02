import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createCore } from "./core.ts";
import { createConfigFile } from "./settings/config-file.ts";
import { createLocalStateFile } from "./settings/local-state-file.ts";
import { createSettingsFile } from "./settings/settings-file.ts";
import { testThemes } from "./testing/themes.ts";
import { createFakeGitHub } from "./testing/fake-github.ts";
import type {
  IssueList,
  RecentIssue,
  SavedTabs,
  SidebarEntryKey,
  SidebarSelection,
} from "./contract.ts";

let home: string;
let core: ReturnType<typeof createCore>;
let github: ReturnType<typeof createFakeGitHub>;
function launch() {
  const host = {
    platform: process.platform,
    env: { VERDANDI_HOME: home, PATH: home },
    homedir: home,
  };
  return createCore({
    host,
    settings: createSettingsFile(host),
    localState: createLocalStateFile(host),
    config: createConfigFile(host, testThemes),
    github: () => github,
    runCommand: () =>
      Promise.resolve({
        kind: "exited",
        exitCode: 0,
        stdout: "gh version 2.101.0 (2026-09-15)\n",
        stderr: "",
      }),
  });
}
function restart() {
  core.dispose();
  core = launch();
}
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "verdandi-desktop-state-"));
  github = createFakeGitHub({ login: "octo-reader" });
  core = launch();
});
afterEach(async () => {
  core.dispose();
  await rm(home, { recursive: true, force: true });
});

/** One tab on an entry, with no issue pages opened from its list. */
function tabOn(entry: SidebarEntryKey | { kind: "all" }): SavedTabs {
  return { tabs: [{ kind: "entry", entry, issues: [] }], shown: 0 };
}

/** The entry of the tab shown, as it is restored. */
async function shownEntry(): Promise<SidebarSelection | undefined> {
  const { tabs, shown } = await core.getTabs();
  const tab = tabs[shown];
  return tab?.kind === "entry" ? tab.entry : undefined;
}

/** The tabs restored when there is nothing to restore: one tab on All. */
const allTab = {
  tabs: [{ kind: "entry", entry: { kind: "all" }, issues: [] }],
  shown: 0,
};

async function writeSettings(settings: object) {
  await writeFile(join(home, "settings.json"), JSON.stringify(settings));
}

async function writeLocalState(state: object | string) {
  await mkdir(join(home, "desktop"), { recursive: true });
  await writeFile(
    join(home, "desktop/state.json"),
    typeof state === "string" ? state : JSON.stringify(state),
  );
}

it("remembers the tabs with their issue pages while tree expansion starts fresh", async () => {
  github.addRepository("acme/api", [
    { number: 1, title: "Parent", subIssues: ["acme/api#2"] },
    { number: 2, title: "Sub-issue" },
  ]);
  await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
  const scope = {
    kind: "repository" as const,
    repository: { owner: "acme", name: "api" },
  };
  async function openList() {
    let latest: IssueList | undefined;
    const stop = core.on("listChanged", (list) => {
      latest = list;
    });
    await core.openList(scope);
    await expect.poll(() => latest?.loading.status).toBe("current");
    return { latest: () => latest, stop };
  }
  const page = {
    id: "I_acme/api#2",
    reference: "#2",
    title: "Sub-issue",
    url: "https://github.com/acme/api/issues/2",
  };
  await core.saveTabs({
    tabs: [{ kind: "entry", entry: scope, issues: [page] }],
    shown: 0,
  });
  const first = await openList();
  await core.setExpanded(scope, "I_acme/api#1", false);
  expect(first.latest()?.trees[0]?.expanded).toBe(false);
  first.stop();
  await core.openIssuePage("I_acme/api#2");
  restart();
  expect(await core.getTabs()).toEqual({
    tabs: [{ kind: "entry", entry: scope, issues: [page] }],
    shown: 0,
  });
  const next = await openList();
  expect(next.latest()?.trees[0]?.expanded).toBe(true);
  next.stop();
});

it("restores every tab in its order, the one shown, and new tabs with the repository #12 names", async () => {
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api", id: 42 }, { name: "acme/web" }],
    views: [{ id: "bugs", name: "Bugs", query: "label:bug" }],
  });
  const issue = { id: "I_1", reference: "acme/web#1", title: "One" };
  await core.saveTabs({
    tabs: [
      { kind: "entry", entry: { kind: "view", id: "bugs" }, issues: [] },
      { kind: "new", from: { owner: "acme", name: "api" } },
      { kind: "entry", entry: { kind: "all" }, issues: [issue] },
      { kind: "new", from: undefined },
      {
        kind: "entry",
        entry: {
          kind: "repository",
          repository: { owner: "acme", name: "web" },
        },
        issues: [],
      },
    ],
    shown: 2,
  });
  restart();
  expect(await core.getTabs()).toEqual({
    tabs: [
      {
        kind: "entry",
        entry: {
          kind: "view",
          view: { id: "bugs", name: "Bugs", query: "label:bug" },
        },
        issues: [],
      },
      { kind: "new", from: { owner: "acme", name: "api", id: 42 } },
      { kind: "entry", entry: { kind: "all" }, issues: [issue] },
      { kind: "new", from: undefined },
      {
        kind: "entry",
        entry: {
          kind: "repository",
          repository: { owner: "acme", name: "web" },
        },
        issues: [],
      },
    ],
    shown: 2,
  });
});

it("restores a repository with its ID, for removing it by its ID", async () => {
  await writeSettings({
    version: 1,
    repositories: [
      { name: "acme/api", id: 42 },
      { name: "acme/api", id: 99 },
    ],
  });
  const repository = { owner: "acme", name: "api", id: 99 };
  await core.saveTabs(tabOn({ kind: "repository", repository }));
  restart();
  const entry = await shownEntry();
  expect(entry).toEqual({
    kind: "repository",
    repository: { owner: "acme", name: "api", id: 99 },
  });
  if (entry?.kind !== "repository") throw new Error("Expected a repository");
  expect(await core.removeRepository(entry.repository)).toEqual({ ok: true });
  expect(await core.getSidebar()).toMatchObject({
    repositories: [{ repository: { owner: "acme", name: "api", id: 42 } }],
  });
});

it("restores a repository by name when its ID is unknown, using the current spelling", async () => {
  await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
  expect(await core.getTabs()).toEqual(allTab);
  await core.saveTabs(
    tabOn({
      kind: "repository",
      repository: { owner: "acme", name: "api" },
    }),
  );
  await writeSettings({ version: 1, repositories: [{ name: "ACME/API" }] });
  restart();
  expect(await shownEntry()).toEqual({
    kind: "repository",
    repository: { owner: "ACME", name: "API" },
  });
});

it("restores normal window bounds and maximised state without creating portable user data", async () => {
  expect(await core.getWindowState()).toBeUndefined();
  await core.saveWindowState({
    x: -1200,
    y: 40,
    width: 1100,
    height: 720,
    maximized: true,
  });
  restart();
  expect(await core.getWindowState()).toEqual({
    x: -1200,
    y: 40,
    width: 1100,
    height: 720,
    maximized: true,
  });
  await expect(readFile(join(home, "settings.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("follows a known repository ID through a transfer even when its old name is taken over", async () => {
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api", id: 42 }],
  });
  await core.saveTabs({
    tabs: [
      {
        kind: "entry",
        entry: {
          kind: "repository",
          repository: { owner: "acme", name: "api" },
        },
        issues: [],
      },
      { kind: "new", from: { owner: "acme", name: "api" } },
    ],
    shown: 0,
  });
  await writeSettings({
    version: 1,
    repositories: [
      { name: "acme/api", id: 99 },
      { name: "octo/service", id: 42 },
    ],
  });
  restart();
  expect(await core.getTabs()).toEqual({
    tabs: [
      {
        kind: "entry",
        entry: {
          kind: "repository",
          repository: { owner: "octo", name: "service", id: 42 },
        },
        issues: [],
      },
      { kind: "new", from: { owner: "octo", name: "service", id: 42 } },
    ],
    shown: 0,
  });
});

it("keeps rapid window and tab changes in order without losing the chosen gh", async () => {
  await writeLocalState({ ghExecutable: join(home, "gh") });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api", id: 42 }],
  });
  await Promise.all([
    core.saveWindowState({
      x: 10,
      y: 20,
      width: 900,
      height: 600,
      maximized: false,
    }),
    core.saveTabs(
      tabOn({
        kind: "repository",
        repository: { owner: "acme", name: "api" },
      }),
    ),
    core.recordRecentIssue({
      id: "I_1",
      repository: { owner: "acme", name: "api" },
      number: 1,
      title: "One",
    }),
    core.saveWindowState({
      x: 30,
      y: 40,
      width: 1100,
      height: 800,
      maximized: true,
    }),
    core.saveTabs(tabOn({ kind: "all" })),
  ]);
  restart();
  expect(await core.getWindowState()).toEqual({
    x: 30,
    y: 40,
    width: 1100,
    height: 800,
    maximized: true,
  });
  expect(await core.getTabs()).toEqual(allTab);
  expect(await core.getRecentIssues()).toHaveLength(1);
  expect(
    JSON.parse(await readFile(join(home, "desktop/state.json"), "utf8")),
  ).toMatchObject({ ghExecutable: join(home, "gh") });
});

it("reads the tabs after a pending change, including its repository ID lookup", async () => {
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api", id: 42 }],
  });
  const entry = {
    kind: "repository" as const,
    repository: { owner: "acme", name: "api" },
  };
  const saving = core.saveTabs(tabOn(entry));
  const restored = await shownEntry();
  await saving;
  expect(restored).toEqual({
    kind: "repository",
    repository: { owner: "acme", name: "api", id: 42 },
  });
});

it("restores a view by ID with its edited name and query, leaving portable data untouched", async () => {
  await writeSettings({
    version: 1,
    views: [{ id: "bugs", name: "Bugs", query: "label:bug" }],
  });
  await core.saveTabs(tabOn({ kind: "view", id: "bugs" }));
  const edited = JSON.stringify({
    version: 1,
    views: [{ id: "bugs", name: "Open bugs", query: "is:open label:bug" }],
  });
  await writeFile(join(home, "settings.json"), edited);
  restart();
  expect(await shownEntry()).toEqual({
    kind: "view",
    view: { id: "bugs", name: "Open bugs", query: "is:open label:bug" },
  });
  expect(await readFile(join(home, "settings.json"), "utf8")).toBe(edited);
});

it.each<SidebarEntryKey>([
  { kind: "repository", repository: { owner: "acme", name: "api" } },
  { kind: "repository", repository: { owner: "acme", name: "web" } },
  { kind: "view", id: "bugs" },
])(
  "shows All in a tab whose entry is gone, keeping its issue pages (%s)",
  async (entry) => {
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api", id: 42 }, { name: "acme/web" }],
      views: [{ id: "bugs", name: "Bugs", query: "label:bug" }],
    });
    const issue = { id: "I_1", reference: "acme/api#1", title: "One" };
    await core.saveTabs({
      tabs: [
        { kind: "entry", entry, issues: [issue] },
        { kind: "new", from: { owner: "acme", name: "api" } },
      ],
      shown: 0,
    });
    await writeSettings({
      version: 1,
      repositories: [{ name: "acme/api", id: 99 }],
      views: [{ id: "new-bugs", name: "Bugs", query: "label:bug" }],
    });
    restart();
    expect(await core.getTabs()).toEqual({
      tabs: [
        { kind: "entry", entry: { kind: "all" }, issues: [issue] },
        { kind: "new", from: undefined },
      ],
      shown: 0,
    });
  },
);

it("restores the entry an earlier version selected last as the one tab", async () => {
  await writeSettings({
    version: 1,
    views: [{ id: "bugs", name: "Bugs", query: "label:bug" }],
  });
  await writeLocalState({ selectedEntry: { kind: "view", id: "bugs" } });
  expect(await core.getTabs()).toEqual({
    tabs: [
      {
        kind: "entry",
        entry: {
          kind: "view",
          view: { id: "bugs", name: "Bugs", query: "label:bug" },
        },
        issues: [],
      },
    ],
    shown: 0,
  });
  await core.saveTabs(tabOn({ kind: "all" }));
  restart();
  expect(await core.getTabs()).toEqual(allTab);
  expect(
    JSON.parse(await readFile(join(home, "desktop/state.json"), "utf8")),
  ).not.toHaveProperty("selectedEntry");
});

it("drops the tabs and issue pages that cannot be read, and shows one that can", async () => {
  await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
  const issue = { id: "I_1", reference: "#1", title: "One" };
  await writeLocalState({
    tabs: {
      tabs: [
        { kind: "entry", entry: { kind: "view", id: 42 }, issues: [] },
        {
          kind: "entry",
          entry: { kind: "repository", name: "acme/api" },
          issues: [issue, { id: "I_2", title: "No reference" }, "I_3"],
        },
        { kind: "new", from: { kind: "repository", name: "bad name" } },
        { kind: "elsewhere" },
      ],
      shown: 7,
    },
  });
  expect(await core.getTabs()).toEqual({
    tabs: [
      {
        kind: "entry",
        entry: {
          kind: "repository",
          repository: { owner: "acme", name: "api" },
        },
        issues: [issue],
      },
      { kind: "new", from: undefined },
    ],
    shown: 1,
  });
});

it.each([
  "{broken",
  "null",
  "[]",
  JSON.stringify({
    window: { x: 0, y: 0, width: -1, height: 800, maximized: false },
    tabs: { tabs: [], shown: 0 },
    recentIssues: {},
  }),
  JSON.stringify({
    window: { x: "0", y: 0, width: 1200, height: 800, maximized: false },
    tabs: [{ kind: "entry", entry: { kind: "all" }, issues: [] }],
    selectedEntry: { kind: "view", id: 42 },
  }),
])("silently defaults when local state cannot be read (%s)", async (state) => {
  await writeLocalState(state);
  expect(await core.getWindowState()).toBeUndefined();
  expect(await core.getTabs()).toEqual(allTab);
  expect(await core.getRecentIssues()).toEqual([]);
  await core.saveWindowState({
    x: 10,
    y: 20,
    width: 1000,
    height: 700,
    maximized: false,
  });
  await core.saveTabs(tabOn({ kind: "all" }));
  restart();
  expect(await core.getWindowState()).toEqual({
    x: 10,
    y: 20,
    width: 1000,
    height: 700,
    maximized: false,
  });
});

it("defaults for an unreadable local file and can save again after the filesystem is repaired", async () => {
  await mkdir(join(home, "desktop/state.json"), { recursive: true });
  expect(await core.getWindowState()).toBeUndefined();
  expect(await core.getTabs()).toEqual(allTab);
  await expect(core.saveTabs(tabOn({ kind: "all" }))).rejects.toThrow();
  await rm(join(home, "desktop/state.json"), { recursive: true });
  await core.saveWindowState({
    x: 10,
    y: 20,
    width: 1000,
    height: 700,
    maximized: false,
  });
  restart();
  expect(await core.getWindowState()).toEqual({
    x: 10,
    y: 20,
    width: 1000,
    height: 700,
    maximized: false,
  });
});

/** A recent issue in `acme/api`, by its number. */
function recent(number: number): RecentIssue {
  return {
    id: `I_acme/api#${String(number)}`,
    repository: { owner: "acme", name: "api" },
    number,
    title: `Issue ${String(number)}`,
  };
}

it("keeps the last 20 recent issues, newest first, each once, across a restart", async () => {
  expect(await core.getRecentIssues()).toEqual([]);
  for (let number = 1; number <= 22; number++)
    await core.recordRecentIssue(recent(number));
  await core.recordRecentIssue({ ...recent(10), title: "Renamed" });
  restart();
  const recents = await core.getRecentIssues();
  expect(recents.map(({ number }) => number)).toEqual([
    10, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 9, 8, 7, 6, 5, 4, 3,
  ]);
  expect(recents[0]).toEqual({ ...recent(10), title: "Renamed" });
  await expect(readFile(join(home, "settings.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("keeps the recent issues when GitHub is read as another account", async () => {
  await core.getSetup();
  await core.recordRecentIssue(recent(1));
  github.signInAs("octo-writer");
  await expect
    .poll(async () => {
      const setup = await core.checkSetupAgain();
      return setup.status === "ready" && setup.account.status === "known"
        ? setup.account.account.login
        : undefined;
    })
    .toBe("octo-writer");
  expect(await core.getRecentIssues()).toEqual([recent(1)]);
});

it("drops the recent issues that cannot be read", async () => {
  await writeLocalState({
    recentIssues: [
      recent(1),
      { ...recent(2), number: "2" },
      { ...recent(3), repository: "acme/api" },
      { ...recent(4), id: "" },
      recent(5),
      recent(5),
    ],
  });
  expect(await core.getRecentIssues()).toEqual([recent(1), recent(5)]);
});
