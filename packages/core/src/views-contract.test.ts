import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type {
  Contract,
  IssueNode,
  IssuePage,
  SidebarEntries,
  ViewEntry,
  ViewList,
  ViewTree,
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

/** Whether a view has run its search and read the issues its trees show. */
function settled(list: ViewList): boolean {
  return (
    list.loading.status !== "loading" &&
    list.loading.status !== "refreshing" &&
    !list.readingContext
  );
}

/**
 * The rows a view's trees show, top to bottom, each indented by its depth:
 * `owner/name#12`, whether it is a match or a context issue, ▾ when
 * expanded and ▸ when collapsed, the matches inside a collapsed issue, and
 * a tree's missing parent issue above it.
 */
function outline(trees: readonly ViewTree[]): string[] {
  const rows: string[] = [];
  function add(node: IssueNode, depth: number) {
    const { owner, name } = node.issue.repository;
    const hasSubIssues = node.subIssues.length > 0;
    const inside = node.view?.matchesInside ?? 0;
    rows.push(
      [
        `${"  ".repeat(depth)}${owner}/${name}${node.issue.reference}`,
        node.view?.match ? "match" : "context",
        ...(hasSubIssues ? [node.expanded ? "▾" : "▸"] : []),
        ...(hasSubIssues && !node.expanded && inside > 0
          ? [`(${String(inside)} inside)`]
          : []),
        ...(node.unread ? [node.unread.status] : []),
      ].join(" "),
    );
    if (node.expanded) for (const sub of node.subIssues) add(sub, depth + 1);
  }
  for (const tree of trees) {
    const { missingParent } = tree;
    if (missingParent) {
      rows.push(
        missingParent.status === "loading"
          ? "(parent loading)"
          : `(parent ${missingParent.problem.kind})`,
      );
    }
    add(tree, missingParent && missingParent.status !== "loading" ? 1 : 0);
  }
  return rows;
}

/**
 * A billing parent issue in `acme/api` with sub-issues in two repositories, one
 * nested two levels deep, and an unrelated issue.
 */
function githubWithBilling(): FakeGitHub {
  const github = createFakeGitHub({ login: "octo-reader" });
  github.addRepository("acme/api", [
    {
      number: 10,
      title: "Billing",
      subIssues: ["acme/api#11", "acme/api#12", "other/lib#20"],
    },
    { number: 11, title: "Invoices", subIssues: ["acme/api#13"] },
    { number: 12, title: "Refunds", state: "closed" },
    { number: 13, title: "PDF export" },
    { number: 14, title: "Unrelated" },
  ]);
  github.addRepository("other/lib", [{ number: 20, title: "Currency" }]);
  return github;
}

it("shows every match under its whole ancestry, with the other sub-issues of each ancestor as context", async () => {
  const github = githubWithBilling();
  github.setSearch("label:billing", {
    matches: ["acme/api#13", "acme/api#12"],
  });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [{ id: "billing", name: "Billing", query: "label:billing" }],
  });
  const core = createTestCore(github);

  const list = await nextView(core, () => core.openView("billing"), settled);

  expect(outline(list.trees)).toEqual([
    "acme/api#10 context ▾",
    "  acme/api#11 context ▾",
    "    acme/api#13 match",
    "  acme/api#12 match",
    "  other/lib#20 context",
  ]);
  expect(list.trees[0]?.subIssues[2]?.issue).toMatchObject({
    title: "Currency",
    external: true,
  });
  expect(list.matchesShown).toBe(2);
  // Relationships and context are read by ID, many at once.
  expect(
    github.received.filter((read) => read.startsWith("fetchIssues ")).length,
  ).toBeLessThanOrEqual(3);
});

it("starts a match without a matching sub-issue collapsed, and shows its sub-issues as context once expanded", async () => {
  const github = githubWithBilling();
  github.setSearch("label:invoices", { matches: ["acme/api#11"] });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [{ id: "inv", name: "Invoices", query: "label:invoices" }],
  });
  const core = createTestCore(github);
  const view = { kind: "view", viewId: "inv" } as const;

  const list = await nextView(core, () => core.openView("inv"), settled);

  expect(outline(list.trees)).toEqual([
    "acme/api#10 context ▾",
    "  acme/api#11 match ▸",
    "  acme/api#12 context",
    "  other/lib#20 context",
  ]);

  const collapsed = await nextView(core, () =>
    core.setExpanded(view, "I_acme/api#10", false),
  );
  expect(outline(collapsed.trees)).toEqual([
    "acme/api#10 context ▸ (1 inside)",
  ]);

  await core.setExpanded(view, "I_acme/api#10", true);
  const expanded = await nextView(
    core,
    () => core.setExpanded(view, "I_acme/api#11", true),
    settled,
  );
  expect(outline(expanded.trees)).toEqual([
    "acme/api#10 context ▾",
    "  acme/api#11 match ▾",
    "    acme/api#13 context",
    "  acme/api#12 context",
    "  other/lib#20 context",
  ]);
});

it("shows each issue once, a matching sub-issue of a match below it", async () => {
  const github = githubWithBilling();
  github.setSearch("label:billing", {
    matches: ["acme/api#13", "acme/api#10", "acme/api#11"],
  });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [{ id: "billing", name: "Billing", query: "label:billing" }],
  });
  const core = createTestCore(github);

  const list = await nextView(core, () => core.openView("billing"), settled);

  expect(outline(list.trees)).toEqual([
    "acme/api#10 match ▾",
    "  acme/api#11 match ▾",
    "    acme/api#13 match",
    "  acme/api#12 context",
    "  other/lib#20 context",
  ]);
  expect(list.matchesShown).toBe(3);
});

it("orders the trees by the search's rank of the first match anywhere inside each", async () => {
  const github = githubWithBilling();
  github.setSearch("first", { matches: ["acme/api#14", "acme/api#13"] });
  github.setSearch("second", {
    matches: ["acme/api#13", "acme/api#14", "acme/api#10"],
  });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [
      { id: "first", name: "First", query: "first" },
      { id: "second", name: "Second", query: "second" },
    ],
  });
  const core = createTestCore(github);

  const first = await nextView(core, () => core.openView("first"), settled);
  expect(first.trees.map(({ issue }) => issue.id)).toEqual([
    "I_acme/api#14",
    "I_acme/api#10",
  ]);

  const second = await nextView(core, () => core.openView("second"), settled);
  expect(second.trees.map(({ issue }) => issue.id)).toEqual([
    "I_acme/api#10",
    "I_acme/api#14",
  ]);
});

it("expands a path to a match the first time it shows, and never again once the user collapsed it", async () => {
  const github = githubWithBilling();
  github.setSearch("label:billing", { matches: ["acme/api#12"] });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [{ id: "billing", name: "Billing", query: "label:billing" }],
  });
  const core = createTestCore(github);
  const view = { kind: "view", viewId: "billing" } as const;
  const opened = await nextView(core, () => core.openView("billing"), settled);
  expect(outline(opened.trees)).toEqual([
    "acme/api#10 context ▾",
    "  acme/api#11 context ▸",
    "  acme/api#12 match",
    "  other/lib#20 context",
  ]);
  await nextView(core, () => core.setExpanded(view, "I_acme/api#10", false));

  github.setSearch("label:billing", {
    matches: ["acme/api#12", "acme/api#13"],
  });
  const refreshed = await nextView(
    core,
    () => core.refresh(view),
    (list) => settled(list) && list.matchesShown === 2,
  );

  expect(outline(refreshed.trees)).toEqual([
    "acme/api#10 context ▸ (2 inside)",
  ]);
  const expanded = await nextView(core, () =>
    core.setExpanded(view, "I_acme/api#10", true),
  );
  // #11 is on a path to a match for the first time.
  expect(outline(expanded.trees)).toEqual([
    "acme/api#10 context ▾",
    "  acme/api#11 context ▾",
    "    acme/api#13 match",
    "  acme/api#12 match",
    "  other/lib#20 context",
  ]);
});

it("shows the matches in the search's order with their parent issues loading, then moves them under their parents", async () => {
  const github = githubWithBilling();
  github.setSearch("label:billing", {
    matches: ["acme/api#13", "acme/api#14"],
  });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [{ id: "billing", name: "Billing", query: "label:billing" }],
  });
  const core = createTestCore(github);
  github.pause("fetchIssues");

  const searched = await nextView(
    core,
    () => core.openView("billing"),
    (list) => list.loading.status === "current",
  );

  expect(searched.readingContext).toBe(true);
  // #14 has no parent issue, as the search says.
  expect(outline(searched.trees)).toEqual([
    "(parent loading)",
    "acme/api#13 match",
    "acme/api#14 match",
  ]);

  const placed = nextView(core, () => Promise.resolve(), settled);
  github.resume();
  expect(outline((await placed).trees)).toEqual([
    "acme/api#10 context ▾",
    "  acme/api#11 context ▾",
    "    acme/api#13 match",
    "  acme/api#12 context",
    "  other/lib#20 context",
    "acme/api#14 match",
  ]);
  // Matches first, then their ancestors level by level, with the
  // sub-issues each shows.
  expect(
    github.received.filter((read) => read.startsWith("fetchIssues ")),
  ).toEqual([
    "fetchIssues acme/api#13 acme/api#14",
    "fetchIssues acme/api#11",
    "fetchIssues acme/api#10",
    "fetchIssues acme/api#12 other/lib#20",
  ]);
});

it("puts a placeholder above a match whose parent issue GitHub does not show, and one that could not be loaded until retried", async () => {
  const github = githubWithBilling();
  github.setSearch("label:billing", { matches: ["acme/api#11"] });
  github.setSearch("label:pdf", { matches: ["acme/api#13"] });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [
      { id: "billing", name: "Billing", query: "label:billing" },
      { id: "pdf", name: "PDF", query: "label:pdf" },
    ],
  });
  const core = createTestCore(github);
  github.hide("acme/api#11");

  const hidden = await nextView(core, () => core.openView("pdf"), settled);

  expect(outline(hidden.trees)).toEqual([
    "(parent unavailable)",
    "  acme/api#13 match",
  ]);

  // Once the match is read, reading its parent issue fails.
  github.reveal("acme/api#11");
  const failing = core.on("viewChanged", (list) => {
    if (list.trees[0]?.subIssues.length) {
      github.failWith({ kind: "gh-failed", message: "no connection" });
      failing();
    }
  });
  const failed = await nextView(core, () => core.openView("billing"), settled);
  expect(outline(failed.trees)).toEqual([
    "(parent unreachable)",
    "  acme/api#11 match ▸",
  ]);

  github.failWith(undefined);
  const retried = await nextView(
    core,
    () => core.retry({ kind: "view", viewId: "billing" }),
    (list) => settled(list) && list.trees[0]?.missingParent === undefined,
  );
  expect(outline(retried.trees)).toEqual([
    "acme/api#10 context ▾",
    "  acme/api#11 match ▸",
    "  acme/api#12 context",
    "  other/lib#20 context",
  ]);
});

it("updates a refreshed view in place, showing its trees while their issues are read again", async () => {
  const github = githubWithBilling();
  github.setSearch("label:billing", { matches: ["acme/api#13"] });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [{ id: "billing", name: "Billing", query: "label:billing" }],
  });
  const core = createTestCore(github);
  const view = { kind: "view", viewId: "billing" } as const;
  const before = await nextView(core, () => core.openView("billing"), settled);
  github.pause("fetchIssues");

  const pushed: ViewList[] = [];
  const unsubscribe = core.on("viewChanged", (list) => pushed.push(list));
  const searched = await nextView(
    core,
    () => core.refresh(view),
    (list) => list.loading.status === "current" && list.readingContext,
  );
  unsubscribe();

  for (const list of pushed) {
    expect(outline(list.trees)).toEqual(outline(before.trees));
  }
  expect(searched.trees).toEqual(before.trees);
  const reread = nextView(core, () => Promise.resolve(), settled);
  github.resume();
  expect(outline((await reread).trees)).toEqual(outline(before.trees));
  // Everything it shows is read again, at once.
  const last = github.received.filter((read) =>
    read.startsWith("fetchIssues "),
  );
  expect(new Set(last.at(-1)?.split(" ").slice(1))).toEqual(
    new Set([
      "acme/api#10",
      "acme/api#11",
      "acme/api#12",
      "acme/api#13",
      "other/lib#20",
    ]),
  );
});

it("reads a collapsed context issue's sub-issues only once it shows, one level ahead", async () => {
  const github = createFakeGitHub({ login: "octo-reader" });
  github.addRepository("acme/api", [
    { number: 1, title: "Parent", subIssues: ["acme/api#2", "acme/api#3"] },
    { number: 2, title: "Match" },
    { number: 3, title: "Context", subIssues: ["acme/api#4"] },
    { number: 4, title: "Deeper", subIssues: ["acme/api#5"] },
    { number: 5, title: "Deepest" },
  ]);
  github.setSearch("label:x", { matches: ["acme/api#2"] });
  await writeSettings({
    version: 1,
    repositories: [{ name: "acme/api" }],
    views: [{ id: "x", name: "X", query: "label:x" }],
  });
  const core = createTestCore(github);

  const list = await nextView(core, () => core.openView("x"), settled);

  expect(outline(list.trees)).toEqual([
    "acme/api#1 context ▾",
    "  acme/api#2 match",
    "  acme/api#3 context ▸",
  ]);
  const read = github.received.filter((r) => r.startsWith("fetchIssues "));
  expect(read.join(" ")).toContain("acme/api#4");
  expect(read.join(" ")).not.toContain("acme/api#5");
});

it("reads again a match another screen read before its search, before saying its parent issue is not visible", async () => {
  const clock = createClock();
  const github = createFakeGitHub({ login: "octo-reader" });
  github.addRepository("other/lib", [
    { number: 20, title: "Currency" },
    { number: 21, title: "Rounding" },
  ]);
  github.setSearch("label:rounding", { matches: ["other/lib#21"] });
  await writeSettings({
    version: 1,
    repositories: [{ name: "other/lib" }],
    views: [{ id: "r", name: "Rounding", query: "label:rounding" }],
  });
  const core = createTestCore(github, { now: clock.now });
  // All reads #21 while it has no parent issue.
  await new Promise<void>((resolve) => {
    core.on("listChanged", (list) => {
      if (list.loading.status === "current") resolve();
    });
    void core.openList({ kind: "all" });
  });
  clock.advance(minute);
  github.addRepository("other/lib", [
    { number: 20, title: "Currency", subIssues: ["other/lib#21"] },
    { number: 21, title: "Rounding" },
  ]);

  const list = await nextView(core, () => core.openView("r"), settled);

  expect(outline(list.trees)).toEqual([
    "other/lib#20 context ▾",
    "  other/lib#21 match",
  ]);
});
