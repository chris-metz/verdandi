import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  CheckoutReader,
  CheckoutJob,
  MachineAddress,
  MachineReport,
  ReportedGroup,
} from "./checkouts/port.ts";
import {
  defaultMainBranches,
  type Checkouts,
  type RepositoryAddress,
} from "./contract.ts";
import { createCore } from "./core.ts";
import { createConfigFile } from "./settings/config-file.ts";
import { createLocalStateFile } from "./settings/local-state-file.ts";
import { createSettingsFile } from "./settings/settings-file.ts";
import { createFakeGitHub } from "./testing/fake-github.ts";
import { testFonts } from "./testing/fonts.ts";
import { testThemes } from "./testing/themes.ts";

const acmeApi: RepositoryAddress = { owner: "acme", name: "api" };
const acmeWeb: RepositoryAddress = { owner: "acme", name: "web" };

/**
 * Stands in for git on every machine: answers each machine's read with
 * what a test set, or with no checkouts, and holds reads back while a test
 * says so.
 */
function createFakeReader() {
  const calls: { machine: MachineAddress; job: CheckoutJob }[] = [];
  const answers = new Map<string, MachineReport>();
  let held: Promise<void> | undefined;
  let release: () => void = () => undefined;
  const key = (machine: MachineAddress) =>
    machine.kind === "this" ? "this" : machine.address;
  const reader: CheckoutReader = {
    async read(machine, job) {
      calls.push({ machine, job });
      await held;
      return (
        answers.get(key(machine)) ?? {
          ok: true,
          groups: [],
          moved: 0,
          created: 0,
        }
      );
    },
  };
  return {
    reader,
    calls,
    /** Answers a machine's reads: `this`, or a host's address. */
    answer(machine: string, report: MachineReport) {
      answers.set(machine, report);
    },
    /** Holds every read back until the release it returns. */
    hold(): () => void {
      held = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        held = undefined;
        release();
      };
    },
  };
}

/** A checkout group as git might report it, with its main branches. */
function group(
  repository: RepositoryAddress,
  branches: Record<string, [ahead: number, behind: number]>,
  path = `~/code/${repository.name}`,
): ReportedGroup {
  return {
    repository,
    checkouts: [{ path, branch: "main", changedFiles: 0 }],
    mainBranches: Object.entries(branches).map(([name, [ahead, behind]]) => ({
      name,
      upstream: { status: "tracking", ahead, behind },
    })),
    fetch: { ok: true },
  };
}

let home: string;
let time: number;
let fake: ReturnType<typeof createFakeReader>;
let core: ReturnType<typeof createCore>;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "verdandi-checkouts-contract-"));
  time = Date.UTC(2026, 9, 22, 10);
  fake = createFakeReader();
  core = createTestCore(fake.reader);
});
afterEach(async () => {
  core.dispose();
  await rm(home, { recursive: true, force: true });
});

function createTestCore(reader: CheckoutReader | undefined) {
  const host = {
    platform: process.platform,
    env: { VERDANDI_HOME: home },
    homedir: home,
  };
  return createCore({
    host,
    settings: createSettingsFile(host),
    localState: createLocalStateFile(host),
    config: createConfigFile(host, testThemes, testFonts),
    github: () => createFakeGitHub({ login: "octo-reader" }),
    runCommand: () => Promise.resolve({ kind: "not-found" }),
    ...(reader ? { checkouts: reader } : {}),
    now: () => time,
  });
}

const settingsFile = () => join(home, "settings.json");
async function track(...repositories: RepositoryAddress[]) {
  await writeFile(
    settingsFile(),
    JSON.stringify({
      version: 1,
      repositories: repositories.map(({ owner, name }) => ({
        name: `${owner}/${name}`,
      })),
    }),
  );
}
async function turnOn() {
  expect(await core.changeConfig({ checkouts: true })).toEqual({ ok: true });
}
/** Checkouts once they match, as they are pushed or read again. */
async function settled(expected: object): Promise<Checkouts> {
  let latest: Checkouts | undefined;
  await vi.waitFor(async () => {
    latest = await core.getCheckouts();
    expect(latest).toMatchObject(expected);
  });
  return latest as Checkouts;
}

it("is off until config.toml turns it on, and runs no git meanwhile", async () => {
  await track(acmeApi);
  expect(await core.getCheckouts()).toEqual({ status: "off" });
  await core.openCheckouts();
  await core.revalidate({ kind: "checkouts" });
  expect(fake.calls).toEqual([]);

  const pushed: Checkouts[] = [];
  core.on("checkoutsChanged", (checkouts) => pushed.push(checkouts));
  await turnOn();
  await vi.waitFor(() => {
    expect(pushed.at(-1)).toMatchObject({
      machines: [{ loading: { status: "current" } }],
    });
  });
  expect(fake.calls).toEqual([
    {
      machine: { kind: "this" },
      job: {
        folders: ["~/code"],
        repositories: [acmeApi],
        mainBranches: [...defaultMainBranches],
        update: false,
        programFolders: [],
      },
    },
  ]);
  expect(pushed.at(-1)).toEqual({
    status: "on",
    machines: [
      {
        kind: "this",
        folders: ["~/code"],
        loading: { status: "current", updatedAt: time },
      },
    ],
    repositories: [{ repository: acmeApi, cells: [{ status: "none" }] }],
    behind: 0,
    ahead: 0,
    updating: false,
    lastUpdate: undefined,
  });

  expect(await core.changeConfig({ checkouts: false })).toEqual({ ok: true });
  expect(await core.getCheckouts()).toEqual({ status: "off" });
});

it("is unavailable where Verdandi cannot run git", async () => {
  core.dispose();
  core = createTestCore(undefined);
  await turnOn();
  expect(await core.getCheckouts()).toEqual({ status: "unavailable" });
});

it("shows each tracked repository's checkouts on this machine, whatever the case, and counts the groups behind and ahead", async () => {
  await track(acmeApi, acmeWeb, { owner: "acme", name: "docs" });
  fake.answer("this", {
    ok: true,
    moved: 0,
    created: 0,
    groups: [
      group({ owner: "Acme", name: "API" }, { main: [0, 2], testing: [0, 0] }),
      group(acmeApi, { main: [0, 0] }, "~/code/api-copy"),
      group(acmeWeb, { main: [1, 3] }),
    ],
  });
  await turnOn();
  const checkouts = await settled({
    machines: [{ loading: { status: "current" } }],
  });
  expect(checkouts).toMatchObject({
    repositories: [
      {
        repository: acmeApi,
        cells: [
          {
            status: "found",
            groups: [
              {
                checkouts: [{ path: "~/code/API" }],
                mainBranches: [
                  {
                    name: "main",
                    upstream: { status: "tracking", ahead: 0, behind: 2 },
                  },
                  { name: "testing" },
                ],
              },
              { checkouts: [{ path: "~/code/api-copy" }] },
            ],
          },
        ],
      },
      { repository: acmeWeb, cells: [{ status: "found" }] },
      { repository: { name: "docs" }, cells: [{ status: "none" }] },
    ],
    behind: 2,
    ahead: 1,
  });
});

it("reads a machine again as screens open once it is older than five minutes, at once after it failed, and every machine as Checkouts is opened or refreshed", async () => {
  await track(acmeApi);
  fake.answer("this", {
    ok: true,
    moved: 0,
    created: 0,
    groups: [group(acmeApi, { main: [0, 0] })],
  });
  await turnOn();
  await settled({ machines: [{ loading: { status: "current" } }] });
  expect(fake.calls).toHaveLength(1);

  time += 4 * 60 * 1000;
  await core.openList({ kind: "all" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(fake.calls).toHaveLength(1);
  await core.openCheckouts();
  await vi.waitFor(() => {
    expect(fake.calls).toHaveLength(2);
  });
  await settled({
    machines: [{ loading: { status: "current", updatedAt: time } }],
  });

  time += 6 * 60 * 1000;
  await core.openList({ kind: "all" });
  await vi.waitFor(() => {
    expect(fake.calls).toHaveLength(3);
  });
  await settled({
    machines: [{ loading: { status: "current", updatedAt: time } }],
  });

  const problem = { kind: "failed", message: "git broke" } as const;
  fake.answer("this", { ok: false, problem });
  await core.refresh({ kind: "checkouts" });
  await vi.waitFor(() => {
    expect(fake.calls).toHaveLength(4);
  });
  await settled({
    machines: [{ loading: { status: "stale", updatedAt: time, problem } }],
    repositories: [{ cells: [{ status: "found" }] }],
  });

  fake.answer("this", { ok: true, moved: 0, created: 0, groups: [] });
  await core.revalidate(undefined);
  await vi.waitFor(() => {
    expect(fake.calls).toHaveLength(5);
  });
  await settled({
    machines: [{ loading: { status: "current" } }],
    repositories: [{ cells: [{ status: "none" }] }],
  });
});

it("reads each host saved on the page through ssh, with its folders, and forgets one removed", async () => {
  await track(acmeApi);
  await turnOn();
  await settled({ machines: [{ loading: { status: "current" } }] });

  const saved = await core.saveHost({
    name: " NUC ",
    address: "nuc.example.ts.net",
    folders: ["~/code", " ", "~/work "],
  });
  expect(saved).toEqual({
    status: "saved",
    host: {
      id: expect.any(String) as unknown,
      name: "NUC",
      address: "nuc.example.ts.net",
      folders: ["~/code", "~/work"],
    },
  });
  if (saved.status !== "saved") return;
  const { host } = saved;
  await vi.waitFor(() => {
    expect(fake.calls).toContainEqual({
      machine: { kind: "host", address: "nuc.example.ts.net" },
      job: {
        folders: ["~/code", "~/work"],
        repositories: [acmeApi],
        mainBranches: [...defaultMainBranches],
        update: false,
        programFolders: [],
      },
    });
  });
  await settled({
    machines: [
      { kind: "this" },
      {
        kind: "host",
        host,
        folders: host.folders,
        loading: { status: "current" },
      },
    ],
    repositories: [{ cells: [{ status: "none" }, { status: "none" }] }],
  });
  expect(JSON.parse(await readFile(settingsFile(), "utf8"))).toMatchObject({
    version: 2,
    hosts: [host],
  });

  expect(
    await core.saveHost({ ...host, name: "Workshop", folders: ["~/src"] }),
  ).toEqual({
    status: "saved",
    host: { ...host, name: "Workshop", folders: ["~/src"] },
  });
  await vi.waitFor(() => {
    expect(fake.calls.at(-1)?.job.folders).toEqual(["~/src"]);
  });

  expect(await core.removeHost(host.id)).toEqual({ ok: true });
  await settled({ machines: [{ kind: "this" }] });
  expect(
    ((await core.getCheckouts()) as { machines: unknown[] }).machines,
  ).toHaveLength(1);
  const written = JSON.parse(await readFile(settingsFile(), "utf8")) as object;
  expect(written).toMatchObject({ version: 1 });
  expect(written).not.toHaveProperty("hosts");
});

it.each([
  [{ name: " " }, "Give the host a name."],
  [
    { address: "-oProxyCommand=touch /tmp/owned" },
    "Give the host an address ssh reaches it at, e.g. nuc.example.ts.net, without spaces.",
  ],
  [
    { address: "nuc example" },
    "Give the host an address ssh reaches it at, e.g. nuc.example.ts.net, without spaces.",
  ],
  [
    { folders: [" "] },
    "Name at least one folder its checkouts are in, e.g. ~/code.",
  ],
  [{ id: "gone" }, "The host is no longer in settings.json."],
])("saves no host it could not reach: %j", async (change, message) => {
  await track(acmeApi);
  expect(
    await core.saveHost({
      name: "NUC",
      address: "nuc.example.ts.net",
      folders: ["~/code"],
      ...change,
    }),
  ).toEqual({ status: "failed", message });
  expect(JSON.parse(await readFile(settingsFile(), "utf8"))).not.toHaveProperty(
    "hosts",
  );
});

it("reads a host that cannot log in on its own, as the other machines show", async () => {
  await track(acmeApi);
  const problem = {
    kind: "cannot-log-in",
    message: "octo@nuc: Permission denied (publickey).",
  } as const;
  fake.answer("nuc", { ok: false, problem });
  fake.answer("this", {
    ok: true,
    moved: 0,
    created: 0,
    groups: [group(acmeApi, { main: [0, 0] })],
  });
  await core.saveHost({ name: "NUC", address: "nuc", folders: ["~/code"] });
  await turnOn();
  await settled({
    machines: [
      { kind: "this", loading: { status: "current" } },
      { kind: "host", loading: { status: "failed", problem } },
    ],
    repositories: [{ cells: [{ status: "found" }, { status: "unknown" }] }],
  });
});

it("keeps this machine's folders on this machine, and reads them at once", async () => {
  await track(acmeApi);
  await turnOn();
  await settled({
    machines: [{ folders: ["~/code"], loading: { status: "current" } }],
  });

  expect(await core.setCheckoutFolders(["~/src", " ", "/work"])).toEqual({
    ok: true,
  });
  await vi.waitFor(() => {
    expect(fake.calls.at(-1)?.job.folders).toEqual(["~/src", "/work"]);
  });
  await settled({
    machines: [{ folders: ["~/src", "/work"], loading: { status: "current" } }],
  });
  expect(
    JSON.parse(await readFile(join(home, "desktop", "state.json"), "utf8")),
  ).toMatchObject({ checkoutFolders: ["~/src", "/work"] });

  expect(await core.setCheckoutFolders([" "])).toEqual({
    ok: false,
    message:
      "Name at least one folder this machine's checkouts are in, e.g. ~/code.",
  });
});

it("reads every machine again with other main branches, and a tracked repository added later", async () => {
  await track(acmeApi);
  await turnOn();
  await settled({ machines: [{ loading: { status: "current" } }] });

  expect(
    await core.changeConfig({ mainBranches: ["main", "staging"] }),
  ).toEqual({ ok: true });
  await vi.waitFor(() => {
    expect(fake.calls.at(-1)?.job.mainBranches).toEqual(["main", "staging"]);
  });

  await track(acmeApi, acmeWeb);
  await vi.waitFor(() => {
    expect(fake.calls.at(-1)?.job.repositories).toEqual([acmeApi, acmeWeb]);
  });
  await settled({
    machines: [{ loading: { status: "current" } }],
    repositories: [
      { cells: [{ status: "none" }] },
      { cells: [{ status: "none" }] },
    ],
  });
});

it("updates every machine after any read under way, says so meanwhile, and sums up what it did", async () => {
  await track(acmeApi);
  await turnOn();
  await settled({ machines: [{ loading: { status: "current" } }] });
  fake.answer("this", {
    ok: true,
    moved: 2,
    created: 1,
    groups: [
      {
        ...group(acmeApi, { main: [0, 0], testing: [0, 0] }),
        mainBranches: [
          {
            name: "main",
            upstream: { status: "tracking", ahead: 0, behind: 0 },
          },
          {
            name: "testing",
            upstream: { status: "tracking", ahead: 0, behind: 1 },
            stuck: { reason: "checked-out-elsewhere", message: "~/agents/one" },
          },
          {
            name: "dev",
            upstream: { status: "tracking", ahead: 1, behind: 2 },
          },
        ],
      },
    ],
  });
  fake.answer("nuc", {
    ok: false,
    problem: { kind: "cannot-log-in", message: "No way in." },
  });
  await core.saveHost({ name: "NUC", address: "nuc", folders: ["~/code"] });

  const release = fake.hold();
  await core.refresh({ kind: "checkouts" });
  const before = fake.calls.length;
  await core.updateAllCheckouts();
  await settled({ updating: true });
  release();
  const done = await settled({ updating: false, lastUpdate: { moved: 2 } });
  expect(done).toMatchObject({
    // The diverged branch is behind GitHub too, and stays.
    lastUpdate: { at: time, moved: 2, created: 1, stuck: 2, failedMachines: 1 },
    repositories: [
      {
        cells: [
          {
            status: "found",
            groups: [
              {
                mainBranches: [
                  { name: "main" },
                  {
                    name: "testing",
                    stuck: { reason: "checked-out-elsewhere" },
                  },
                  { name: "dev" },
                ],
              },
            ],
          },
          { status: "unknown" },
        ],
      },
    ],
  });
  const updates = fake.calls.slice(before).filter(({ job }) => job.update);
  expect(updates.map(({ machine }) => machine)).toEqual([
    { kind: "this" },
    { kind: "host", address: "nuc" },
  ]);
});

it("restores a Checkouts tab while it is on, and All in its place while it is off", async () => {
  await core.saveTabs({
    tabs: [{ kind: "entry", entry: { kind: "checkouts" }, issues: [] }],
    shown: 0,
  });
  expect((await core.getTabs()).tabs).toEqual([
    { kind: "entry", entry: { kind: "all" }, issues: [] },
  ]);
  await turnOn();
  expect((await core.getTabs()).tabs).toEqual([
    { kind: "entry", entry: { kind: "checkouts" }, issues: [] },
  ]);
});
