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
import type { IssueList, SidebarEntryKey } from "./contract.ts";

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

it("remembers the sidebar entry while tree expansion and open issue pages start fresh", async () => {
  github.addRepository("acme/api", [
    { number: 1, title: "Parent", subIssues: ["acme/api#2"] },
    { number: 2, title: "Sub-issue" },
  ]);
  await writeFile(
    join(home, "settings.json"),
    JSON.stringify({
      version: 1,
      repositories: [{ name: "acme/api" }],
    }),
  );
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
  await core.selectSidebarEntry(scope);
  const first = await openList();
  await core.setExpanded(scope, "I_acme/api#1", false);
  expect(first.latest()?.trees[0]?.expanded).toBe(false);
  first.stop();
  await core.openIssuePage("I_acme/api#2");
  restart();
  expect(await core.getSelectedSidebarEntry()).toEqual(scope);
  const next = await openList();
  expect(next.latest()?.trees[0]?.expanded).toBe(true);
  next.stop();
});
afterEach(async () => {
  core.dispose();
  await rm(home, { recursive: true, force: true });
});

it("restores a repository by name when its ID is unknown, using the current spelling", async () => {
  await writeFile(
    join(home, "settings.json"),
    JSON.stringify({
      version: 1,
      repositories: [{ name: "acme/api" }],
    }),
  );
  expect(await core.getSelectedSidebarEntry()).toEqual({ kind: "all" });
  await core.selectSidebarEntry({
    kind: "repository",
    repository: { owner: "acme", name: "api" },
  });
  await writeFile(
    join(home, "settings.json"),
    JSON.stringify({
      version: 1,
      repositories: [{ name: "ACME/API" }],
    }),
  );
  restart();
  expect(await core.getSelectedSidebarEntry()).toEqual({
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
  await writeFile(
    join(home, "settings.json"),
    JSON.stringify({
      version: 1,
      repositories: [{ name: "acme/api", id: 42 }],
    }),
  );
  await core.selectSidebarEntry({
    kind: "repository",
    repository: { owner: "acme", name: "api" },
  });
  await writeFile(
    join(home, "settings.json"),
    JSON.stringify({
      version: 1,
      repositories: [
        { name: "acme/api", id: 99 },
        { name: "octo/service", id: 42 },
      ],
    }),
  );
  restart();
  expect(await core.getSelectedSidebarEntry()).toEqual({
    kind: "repository",
    repository: { owner: "octo", name: "service" },
  });
});

it("keeps rapid window and selection changes in order without losing the chosen gh", async () => {
  await mkdir(join(home, "desktop"));
  await writeFile(
    join(home, "desktop/state.json"),
    JSON.stringify({ ghExecutable: join(home, "gh") }),
  );
  await writeFile(
    join(home, "settings.json"),
    JSON.stringify({
      version: 1,
      repositories: [{ name: "acme/api", id: 42 }],
    }),
  );
  await Promise.all([
    core.saveWindowState({
      x: 10,
      y: 20,
      width: 900,
      height: 600,
      maximized: false,
    }),
    core.selectSidebarEntry({
      kind: "repository",
      repository: { owner: "acme", name: "api" },
    }),
    core.saveWindowState({
      x: 30,
      y: 40,
      width: 1100,
      height: 800,
      maximized: true,
    }),
    core.selectSidebarEntry({ kind: "all" }),
  ]);
  restart();
  expect(await core.getWindowState()).toEqual({
    x: 30,
    y: 40,
    width: 1100,
    height: 800,
    maximized: true,
  });
  expect(await core.getSelectedSidebarEntry()).toEqual({ kind: "all" });
  expect(
    JSON.parse(await readFile(join(home, "desktop/state.json"), "utf8")),
  ).toMatchObject({ ghExecutable: join(home, "gh") });
});

it("reads a selection after a pending change, including its repository ID lookup", async () => {
  await writeFile(
    join(home, "settings.json"),
    JSON.stringify({
      version: 1,
      repositories: [{ name: "acme/api", id: 42 }],
    }),
  );
  const selection = {
    kind: "repository" as const,
    repository: { owner: "acme", name: "api" },
  };
  const saving = core.selectSidebarEntry(selection);
  const selected = await core.getSelectedSidebarEntry();
  await saving;
  expect(selected).toEqual(selection);
});

it("restores a view by ID with its edited name and query, leaving portable data untouched", async () => {
  await writeFile(
    join(home, "settings.json"),
    JSON.stringify({
      version: 1,
      views: [{ id: "bugs", name: "Bugs", query: "label:bug" }],
    }),
  );
  await core.selectSidebarEntry({ kind: "view", id: "bugs" });
  const edited = JSON.stringify({
    version: 1,
    views: [{ id: "bugs", name: "Open bugs", query: "is:open label:bug" }],
  });
  await writeFile(join(home, "settings.json"), edited);
  restart();
  expect(await core.getSelectedSidebarEntry()).toEqual({
    kind: "view",
    view: { id: "bugs", name: "Open bugs", query: "is:open label:bug" },
  });
  expect(await readFile(join(home, "settings.json"), "utf8")).toBe(edited);
});

it.each<SidebarEntryKey>([
  { kind: "repository", repository: { owner: "acme", name: "api" } },
  { kind: "repository", repository: { owner: "acme", name: "web" } },
  { kind: "view", id: "bugs" },
])("opens All if the selected entry is gone (%s)", async (entry) => {
  await writeFile(
    join(home, "settings.json"),
    JSON.stringify({
      version: 1,
      repositories: [{ name: "acme/api", id: 42 }, { name: "acme/web" }],
      views: [{ id: "bugs", name: "Bugs", query: "label:bug" }],
    }),
  );
  await core.selectSidebarEntry(entry);
  await writeFile(
    join(home, "settings.json"),
    JSON.stringify({
      version: 1,
      repositories: [{ name: "acme/api", id: 99 }],
      views: [{ id: "new-bugs", name: "Bugs", query: "label:bug" }],
    }),
  );
  restart();
  expect(await core.getSelectedSidebarEntry()).toEqual({ kind: "all" });
});

it.each([
  "{broken",
  "null",
  "[]",
  JSON.stringify({
    window: { x: 0, y: 0, width: -1, height: 800, maximized: false },
    selectedEntry: { kind: "repository", name: "bad name" },
  }),
  JSON.stringify({
    window: { x: "0", y: 0, width: 1200, height: 800, maximized: false },
    selectedEntry: { kind: "view", id: 42 },
  }),
])("silently defaults when local state cannot be read (%s)", async (state) => {
  await mkdir(join(home, "desktop"));
  await writeFile(join(home, "desktop/state.json"), state);
  expect(await core.getWindowState()).toBeUndefined();
  expect(await core.getSelectedSidebarEntry()).toEqual({ kind: "all" });
  await core.saveWindowState({
    x: 10,
    y: 20,
    width: 1000,
    height: 700,
    maximized: false,
  });
  await core.selectSidebarEntry({ kind: "all" });
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
  expect(await core.getSelectedSidebarEntry()).toEqual({ kind: "all" });
  await expect(core.selectSidebarEntry({ kind: "all" })).rejects.toThrow();
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
