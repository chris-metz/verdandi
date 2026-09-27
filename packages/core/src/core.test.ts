import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Account,
  Contract,
  IssueList,
  IssueNode,
  Scope,
  SidebarEntries,
} from "./contract.ts";
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
    const core = createCore({
      github: createFakeGitHub({ login: "octo-reader" }),
      // Without VERDANDI_HOME, APPDATA or XDG_DATA_HOME, the default applies.
      settings: createSettingsFile({
        platform: process.platform,
        env: {},
        homedir,
      }),
    });

    expect(sidebarLines(await core.getSidebar())).toEqual(["acme/api –"]);
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
      all: {
        openIssues: {
          status: "failed",
          message:
            "acme/gone: GitHub reported an error: Could not resolve to a Repository with the name 'acme/gone'.",
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
              "GitHub reported an error: Could not resolve to a Repository with the name 'acme/gone'.",
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
    github.failWith({ kind: "gh-not-found" });
    const core = createTestCore(github);

    const sidebar = await readUntilCounted(core);

    expect(
      sidebar.status === "read" &&
        sidebar.repositories.map(({ openIssues }) => openIssues),
    ).toEqual([
      {
        status: "failed",
        message: "GitHub CLI (gh) was not found on PATH.",
      },
      {
        status: "failed",
        message: "GitHub CLI (gh) was not found on PATH.",
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

  it("takes a count GitHub could not read at first from the repository's list", async () => {
    await writeSettings({ version: 1, repositories: [{ name: "acme/api" }] });
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github);
    expect(sidebarLines(await readUntilCounted(core))).toEqual(["acme/api –"]);

    github.addRepository("acme/api", [
      { number: 2, title: "Dark mode" },
      { number: 1, title: "Crash on start" },
    ]);
    const pushed = await nextSidebar(core, () =>
      openUntilLoaded(core, acmeApi),
    );

    expect(sidebarLines(pushed)).toEqual(["acme/api 2"]);
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
          "acme/gone: GitHub reported an error: Could not resolve to a Repository with the name 'acme/gone'.",
      },
    });
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
        loading: "loaded",
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

  it("says why a repository's issues could not be loaded", async () => {
    const core = createTestCore(createFakeGitHub({ login: "octo-reader" }));

    expect(await openUntilLoaded(core, acmeApi)).toEqual({
      scope: acmeApi,
      trees: [],
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
    github.addRepository("acme/api", [{ number: 1, title: "Crash on start" }]);
    const reopened = await openUntilLoaded(core, acmeApi);

    expect(outline(reopened)).toEqual(["#1 Crash on start"]);
    expect(reopened.loading.status).toBe("loaded");
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
      status: "loaded",
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
      status: "loaded",
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
      status: "loaded",
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
      status: "loaded",
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
      status: "loaded",
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
      status: "loaded",
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

  it("names a tracked repository whose issues could not be loaded, and shows the others", async () => {
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
      status: "failed",
      message:
        "acme/gone: GitHub reported an error: Could not resolve to a Repository with the name 'acme/gone'.",
    });
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
    expect(reopened.loading.status).toBe("loaded");
    expect(github.requestsFor("acme/api")).toBe(1);
  });

  it("says why when the settings file cannot be read", async () => {
    await writeFile(join(home, "settings.json"), '{ "repositories": [ }');
    const github = createFakeGitHub({ login: "octo-reader" });
    const core = createTestCore(github);

    expect(await openUntilLoaded(core, all)).toEqual({
      scope: all,
      trees: [],
      loading: {
        status: "failed",
        message: expect.stringContaining(
          `${join(home, "settings.json")} is not valid JSON:`,
        ) as unknown,
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
      loading: { status: "loaded", openIssues: 0, closedNotListed: 0 },
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
      status: "loaded",
      openIssues: 1,
      closedNotListed: 0,
    });
  });
});
