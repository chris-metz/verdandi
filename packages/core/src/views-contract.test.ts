import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type {
  Contract,
  IssuePage,
  SidebarEntries,
  ViewEntry,
  ViewList,
} from "./contract.ts";
import { createCore } from "./core.ts";
import type { HostEnvironment } from "./directories.ts";
import { createLocalStateFile } from "./settings/local-state-file.ts";
import { createSettingsFile } from "./settings/settings-file.ts";
import { createFakeGitHub, type FakeGitHub } from "./testing/fake-github.ts";

/** A temporary `VERDANDI_HOME`, so tests never touch the real user data. */
let home: string;
const cores: ReturnType<typeof createCore>[] = [];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "verdandi-views-"));
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
    wait: () => Promise.resolve(),
    ...(now ? { now } : {}),
  });
  cores.push(core);
  return core;
}

/** A fake GitHub with a tracked-looking repository and an untracked one. */
function githubWithIssues(): FakeGitHub {
  const github = createFakeGitHub({ login: "octo-reader" });
  github.addRepository("acme/api", [
    { number: 3, title: "Rate limits" },
    { number: 2, title: "Retry budget", state: "closed" },
    { number: 1, title: "Billing" },
  ]);
  github.addRepository("other/lib", [{ number: 5, title: "Upstream fix" }]);
  return github;
}

/** The searches GitHub received so far. */
function searches(github: FakeGitHub): string[] {
  return github.received.filter((read) => read.startsWith("searchIssues "));
}

/** The next view list pushed that satisfies `until`, after `act`. */
async function nextView(
  core: Contract,
  act: () => Promise<unknown>,
  until: (list: ViewList) => boolean = (list) =>
    list.loading.status !== "loading" && list.loading.status !== "refreshing",
): Promise<ViewList> {
  const pushed = new Promise<ViewList>((resolve) => {
    const unsubscribe = core.on("viewChanged", (list) => {
      if (until(list)) {
        unsubscribe();
        resolve(list);
      }
    });
  });
  await act();
  return pushed;
}

/** The sidebar's views, once it has read the settings file. */
function viewsOf(sidebar: SidebarEntries): ViewEntry[] {
  if (sidebar.status !== "read") throw new Error("The sidebar failed.");
  return sidebar.views;
}

it("saves a new view after its search ran once, and opens it with those matches without searching again", async () => {
  const github = githubWithIssues();
  github.setSearch("is:open label:billing", {
    matches: ["acme/api#1", "other/lib#5"],
  });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [{ id: "first", name: "First", query: "is:open" }],
  });
  const core = createTestCore(github);

  const saved = await core.saveView({
    name: " Billing ",
    query: "is:open label:billing",
  });

  expect(saved).toEqual({
    status: "saved",
    view: {
      id: expect.stringMatching(/^[a-z0-9]{8,}$/) as unknown,
      name: "Billing",
      query: "is:open label:billing",
    },
  });
  const id = saved.status === "saved" ? saved.view.id : "";
  expect(await readSettings()).toEqual({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [
      { id: "first", name: "First", query: "is:open" },
      { id, name: "Billing", query: "is:open label:billing" },
    ],
  });
  expect(viewsOf(await core.getSidebar())).toEqual([
    {
      view: { id: "first", name: "First", query: "is:open" },
      matches: { status: "unknown" },
    },
    {
      view: { id, name: "Billing", query: "is:open label:billing" },
      matches: { status: "known", count: 2 },
    },
  ]);

  const list = await nextView(core, () => core.openView(id));

  expect(list).toMatchObject({
    view: { id, name: "Billing", query: "is:open label:billing" },
    matchCount: 2,
    loading: { status: "current" },
    trees: [
      {
        issue: {
          id: "I_acme/api#1",
          reference: "#1",
          title: "Billing",
          external: false,
        },
        subIssues: [],
      },
      {
        issue: {
          id: "I_other/lib#5",
          repository: { owner: "other", name: "lib" },
          title: "Upstream fix",
          external: true,
        },
      },
    ],
  });
  expect(searches(github)).toEqual([
    "searchIssues page 1 is:open label:billing",
  ]);
});

it("saves nothing when GitHub rejects the search, and says why in GitHub's words", async () => {
  const github = githubWithIssues();
  github.setSearch("is:open (", {
    rejected: "The search query contains invalid syntax.",
  });
  await writeSettings({ version: 1, repositories: [], views: [] });
  const core = createTestCore(github);

  expect(await core.saveView({ name: "Broken", query: "is:open (" })).toEqual({
    status: "rejected",
    message: "The search query contains invalid syntax.",
  });
  expect(await readSettings()).toEqual({
    version: 1,
    repositories: [],
    views: [],
  });
});

it("offers to save anyway when the search cannot be run, and then saves without searching", async () => {
  const github = githubWithIssues();
  github.setSearch("label:bug", { matches: ["acme/api#3"] });
  await writeSettings({ version: 1, repositories: [], views: [] });
  const core = createTestCore(github);
  github.failNextWith({
    kind: "gh-failed",
    message: "error connecting to api.github.com",
  });

  expect(await core.saveView({ name: "Bugs", query: "label:bug" })).toEqual({
    status: "unchecked",
    problem: {
      kind: "unreachable",
      message: "error connecting to api.github.com",
    },
  });
  expect(await readSettings()).toMatchObject({ views: [] });

  const saved = await core.saveView(
    { name: "Bugs", query: "label:bug" },
    { force: true },
  );

  expect(saved).toMatchObject({ status: "saved", view: { name: "Bugs" } });
  expect(searches(github)).toEqual(["searchIssues page 1 label:bug"]);
  expect(viewsOf(await core.getSidebar())).toEqual([
    {
      view: {
        id: expect.any(String) as unknown,
        name: "Bugs",
        query: "label:bug",
      },
      matches: { status: "unknown" },
    },
  ]);

  // Opened, a view saved unchecked runs its search.
  const id = saved.status === "saved" ? saved.view.id : "";
  const list = await nextView(core, () => core.openView(id));
  expect(list).toMatchObject({ matchCount: 1, loading: { status: "current" } });
  expect(searches(github)).toHaveLength(2);
});

it("saves a new name alone without searching, keeping the view's ID and place", async () => {
  const github = githubWithIssues();
  await writeSettings({
    version: 1,
    repositories: [],
    views: [
      { id: "bugs", name: "Bugs", query: "label:bug" },
      { id: "mine", name: "Mine", query: "assignee:@me" },
    ],
  });
  const core = createTestCore(github);

  expect(
    await core.saveView({ id: "bugs", name: "Open bugs", query: "label:bug" }),
  ).toEqual({
    status: "saved",
    view: { id: "bugs", name: "Open bugs", query: "label:bug" },
  });
  expect(searches(github)).toEqual([]);
  expect(await readSettings()).toEqual({
    version: 1,
    repositories: [],
    views: [
      { id: "bugs", name: "Open bugs", query: "label:bug" },
      { id: "mine", name: "Mine", query: "assignee:@me" },
    ],
  });
});

it("runs a changed search before saving it, keeping the view's ID, and opens with its matches", async () => {
  const github = githubWithIssues();
  github.setSearch("label:bug", { matches: ["acme/api#3"] });
  github.setSearch("label:bug is:closed", { matches: ["acme/api#2"] });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [{ id: "bugs", name: "Bugs", query: "label:bug" }],
  });
  const core = createTestCore(github);
  await nextView(core, () => core.openView("bugs"));

  const saved = await core.saveView({
    id: "bugs",
    name: "Bugs",
    query: "label:bug is:closed",
  });

  expect(saved).toEqual({
    status: "saved",
    view: { id: "bugs", name: "Bugs", query: "label:bug is:closed" },
  });
  const list = await nextView(core, () => core.openView("bugs"));
  expect(list.trees.map(({ issue }) => issue.id)).toEqual(["I_acme/api#2"]);
  expect(searches(github)).toEqual([
    "searchIssues page 1 label:bug",
    "searchIssues page 1 label:bug is:closed",
  ]);
});

it("removes a view alone, moving a removed selection to the next view", async () => {
  const github = githubWithIssues();
  const repositories = [{ name: "acme/api" }, { name: "other/lib" }];
  await writeSettings({
    version: 1,
    repositories,
    views: [
      { id: "a", name: "A", query: "label:a" },
      { id: "b", name: "B", query: "label:b" },
      { id: "c", name: "C", query: "label:c" },
    ],
  });
  const core = createTestCore(github);
  await core.selectSidebarEntry({ kind: "view", id: "b" });

  expect(await core.removeView("b")).toEqual({
    ok: true,
    selection: {
      kind: "view",
      view: { id: "c", name: "C", query: "label:c" },
    },
  });
  expect(await readSettings()).toEqual({
    version: 1,
    repositories,
    views: [
      { id: "a", name: "A", query: "label:a" },
      { id: "c", name: "C", query: "label:c" },
    ],
  });
  expect(await core.removeView("c")).toMatchObject({
    selection: { kind: "view", view: { id: "a" } },
  });
  expect(await core.removeView("a")).toEqual({
    ok: true,
    selection: { kind: "all" },
  });
});

it("never limits a search to the tracked repositories, nor changes views as they are tracked or removed", async () => {
  const github = githubWithIssues();
  github.setSearch("is:open label:billing", {
    matches: ["other/lib#5", "acme/api#1"],
  });
  const views = [
    { id: "billing", name: "Billing", query: "is:open label:billing" },
  ];
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views,
  });
  const core = createTestCore(github);

  const opened = await nextView(core, () => core.openView("billing"));
  expect(opened.trees.map(({ issue }) => [issue.id, issue.external])).toEqual([
    ["I_other/lib#5", true],
    ["I_acme/api#1", false],
  ]);

  await core.addRepositories([{ owner: "other", name: "lib" }]);
  expect(await readSettings()).toMatchObject({ views });
  const tracked = await nextView(core, () =>
    core.refresh({ kind: "view", viewId: "billing" }),
  );
  expect(tracked.trees.map(({ issue }) => issue.external)).toEqual([
    false,
    false,
  ]);

  await core.removeRepository({ owner: "acme", name: "api" });
  await core.removeRepository({ owner: "other", name: "lib" });
  expect(await readSettings()).toMatchObject({ repositories: [], views });
  const untracked = await nextView(core, () =>
    core.refresh({ kind: "view", viewId: "billing" }),
  );
  expect(untracked.trees.map(({ issue }) => issue.id)).toEqual([
    "I_other/lib#5",
    "I_acme/api#1",
  ]);
  expect(new Set(searches(github))).toEqual(
    new Set(["searchIssues page 1 is:open label:billing"]),
  );
});

it("runs no search at startup: a view's count is unknown until it runs, then GitHub's total", async () => {
  const github = githubWithIssues();
  github.setSearch("label:bug", {
    matches: ["acme/api#3", "acme/api#1"],
    total: 4213,
  });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [{ id: "bugs", name: "Bugs", query: "label:bug" }],
  });
  const core = createTestCore(github);

  expect(viewsOf(await core.getSidebar())[0]?.matches).toEqual({
    status: "unknown",
  });
  expect(searches(github)).toEqual([]);

  const counted = new Promise<SidebarEntries>((resolve) => {
    core.on("sidebarChanged", (sidebar) => {
      if (viewsOf(sidebar)[0]?.matches.status === "known") resolve(sidebar);
    });
  });
  const list = await nextView(core, () => core.openView("bugs"));
  expect(list.matchCount).toBe(4213);
  expect(viewsOf(await counted)[0]?.matches).toEqual({
    status: "known",
    count: 4213,
  });
});

it("marks a view whose search GitHub rejected, and runs it again only when refreshed", async () => {
  const github = githubWithIssues();
  github.setSearch("label:bug (", { rejected: "The search is invalid." });
  await writeSettings({
    version: 1,
    repositories: [],
    views: [{ id: "bugs", name: "Bugs", query: "label:bug (" }],
  });
  const core = createTestCore(github);

  const list = await nextView(core, () => core.openView("bugs"));

  expect(list.loading).toEqual({
    status: "failed",
    problem: {
      kind: "error",
      message: "GitHub rejected the search: The search is invalid.",
    },
  });
  expect(list.rejected).toBe("The search is invalid.");
  expect(viewsOf(await core.getSidebar())[0]?.matches).toEqual({
    status: "rejected",
    message: "The search is invalid.",
  });
  await core.retry({ kind: "view", viewId: "bugs" });
  await nextView(
    core,
    () => core.openView("bugs"),
    () => true,
  );
  expect(searches(github)).toHaveLength(1);
  await nextView(core, () => core.refresh({ kind: "view", viewId: "bugs" }));
  expect(searches(github)).toHaveLength(2);
});

it("runs an opened view's search again once it is older than five minutes", async () => {
  const clock = createClock();
  const github = githubWithIssues();
  github.setSearch("label:bug", { matches: ["acme/api#3"] });
  await writeSettings({
    version: 1,
    repositories: [],
    views: [{ id: "bugs", name: "Bugs", query: "label:bug" }],
  });
  const core = createTestCore(github, { now: clock.now });
  await nextView(core, () => core.openView("bugs"));
  await nextView(
    core,
    () => core.openView("bugs"),
    () => true,
  );
  expect(searches(github)).toHaveLength(1);

  clock.advance(6 * minute);
  github.setSearch("label:bug", { matches: ["acme/api#3", "acme/api#1"] });
  const list = await nextView(core, () => core.openView("bugs"));

  expect(list.trees).toHaveLength(2);
  expect(searches(github)).toHaveLength(2);
});

it("counts the pull requests a search also matches, which it does not list", async () => {
  const github = githubWithIssues();
  github.setSearch("is:open", {
    matches: ["acme/api#3"],
    total: 3,
    pullRequests: 2,
  });
  await writeSettings({
    version: 1,
    repositories: [],
    views: [{ id: "open", name: "Open", query: "is:open" }],
  });
  const core = createTestCore(github);

  const list = await nextView(core, () => core.openView("open"));

  expect(list).toMatchObject({ matchCount: 3, pullRequests: 2 });
  expect(list.trees).toHaveLength(1);
});

it("opens the page of a match outside every tracked repository without tracking it", async () => {
  const github = githubWithIssues();
  github.setSearch("label:upstream", { matches: ["other/lib#5"] });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [{ id: "up", name: "Upstream", query: "label:upstream" }],
  });
  const core = createTestCore(github);
  const list = await nextView(core, () => core.openView("up"));
  const [match] = list.trees;
  if (!match) throw new Error("The match is missing.");

  const page = new Promise<IssuePage>((resolve) => {
    core.on("issuePageChanged", (changed) => {
      if (changed.issue) resolve(changed);
    });
  });
  await core.openIssuePage(match.issue.id);

  expect(await page).toMatchObject({
    issue: { title: "Upstream fix", external: true },
  });
  expect(await readSettings()).toMatchObject({
    repositories: [{ name: "acme/api" }],
  });
});
