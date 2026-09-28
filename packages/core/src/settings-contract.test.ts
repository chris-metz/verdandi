import {
  mkdtemp,
  mkdir,
  stat,
  lstat,
  symlink,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createCore } from "./core.ts";
import { createSettingsFile } from "./settings/settings-file.ts";
import { createLocalStateFile } from "./settings/local-state-file.ts";
import { createFakeGitHub } from "./testing/fake-github.ts";

let home: string;
let core: ReturnType<typeof createCore>;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "verdandi-settings-"));
  const host = {
    platform: process.platform,
    env: { VERDANDI_HOME: home },
    homedir: home,
  };
  core = createCore({
    host,
    settings: createSettingsFile(host),
    localState: createLocalStateFile(host),
    github: () => createFakeGitHub({ login: "octo-reader" }),
    runCommand: () => Promise.resolve({ kind: "not-found" }),
  });
});
afterEach(async () => {
  core.dispose();
  await rm(home, { recursive: true, force: true });
});
const file = () => join(home, "settings.json");
const write = (data: unknown) => writeFile(file(), JSON.stringify(data));
const repository = (name: string) => ({
  kind: "repository" as const,
  repository: { owner: "acme", name },
});

it("moves one repository in the latest file, preserving hand edits and persisting file order", async () => {
  await write({
    version: 1,
    repositories: [{ name: "acme/api" }, { name: "acme/web" }],
  });
  await core.getSidebar();
  await write({
    version: 1,
    repositories: [
      { name: "acme/api" },
      { name: "acme/web", id: 42 },
      { name: "acme/tools" },
    ],
    views: [{ id: "bugs", name: "Bugs", query: "is:open" }],
  });
  expect(
    await core.reorderSidebar(repository("web"), { direction: "up" }),
  ).toEqual({ ok: true });
  expect(JSON.parse(await readFile(file(), "utf8"))).toEqual({
    version: 1,
    repositories: [
      { name: "acme/web", id: 42 },
      { name: "acme/api" },
      { name: "acme/tools" },
    ],
    views: [{ id: "bugs", name: "Bugs", query: "is:open" }],
  });
  expect(await core.getSidebar()).toMatchObject({
    repositories: [
      { repository: { name: "web" } },
      { repository: { name: "api" } },
      { repository: { name: "tools" } },
    ],
  });
});

it("keeps the last valid sidebar and refuses to overwrite an unknown field with its entry path", async () => {
  await write({
    version: 1,
    repositories: [{ name: "acme/api" }, { name: "acme/web" }],
  });
  await core.getSidebar();
  const broken = {
    version: 1,
    repositories: [],
    views: [{ name: "Bugs", query: "is:open", typo: true }],
  };
  await write(broken);
  expect(await core.getSidebar()).toMatchObject({
    status: "read",
    repositories: [
      { repository: { name: "api" } },
      { repository: { name: "web" } },
    ],
    settings: {
      status: "invalid",
      message: expect.stringContaining("views[0].typo") as unknown,
    },
  });
  expect(
    await core.reorderSidebar(repository("web"), { direction: "up" }),
  ).toMatchObject({ ok: false });
  expect(JSON.parse(await readFile(file(), "utf8"))).toEqual(broken);
});

it("reads a newer version with unfamiliar fields but never writes or resets it", async () => {
  const future = {
    version: 2,
    repositories: [{ name: "acme/api", color: "blue" }, { name: "acme/web" }],
    future: true,
  };
  await write(future);
  expect(await core.getSidebar()).toMatchObject({
    repositories: [
      { repository: { name: "api" } },
      { repository: { name: "web" } },
    ],
    settings: {
      status: "newer-version",
      message: expect.stringContaining("Update Verdandi") as unknown,
    },
  });
  expect(
    await core.reorderSidebar(repository("web"), { direction: "up" }),
  ).toMatchObject({ ok: false });
  expect(await core.resetSettings()).toMatchObject({ ok: false });
  expect(JSON.parse(await readFile(file(), "utf8"))).toEqual(future);
});

it("migrates version 0 on the next write with one exact backup and cleans up missing IDs and duplicate names", async () => {
  const old = {
    version: 0,
    repositories: [
      { name: "acme/api" },
      { name: "ACME/API" },
      { name: "acme/web" },
    ],
    views: [
      { name: "Bugs", query: "is:open" },
      { name: "Work", query: "label:work" },
    ],
  };
  await write(old);
  const sidebar = await core.getSidebar();
  expect(await readFile(file(), "utf8")).toBe(JSON.stringify(old));
  if (sidebar.status !== "read") throw new Error("Sidebar missing");
  const id = sidebar.views[1]?.view.id;
  if (!id) throw new Error("Second view missing");
  expect(
    await core.reorderSidebar({ kind: "view", id }, { direction: "up" }),
  ).toEqual({ ok: true });
  expect(JSON.parse(await readFile(file(), "utf8"))).toMatchObject({
    version: 1,
    repositories: [{ name: "acme/api" }, { name: "acme/web" }],
    views: [
      { id, name: "Work" },
      { id: expect.any(String) as unknown, name: "Bugs" },
    ],
  });
  expect(await readFile(`${file()}.backup-v0`, "utf8")).toBe(
    JSON.stringify(old),
  );
  await core.reorderSidebar(repository("web"), { direction: "up" });
  expect(await readFile(`${file()}.backup-v0`, "utf8")).toBe(
    JSON.stringify(old),
  );
});

it("watches the folder across atomic replacements, keeps valid data through errors, and sees the fix", async () => {
  await core.getSidebar();
  const pushed: import("./contract.ts").SidebarEntries[] = [];
  core.on("sidebarChanged", (sidebar) => pushed.push(sidebar));
  await write({ version: 1, repositories: [{ name: "acme/api" }] });
  await expect
    .poll(() => pushed.at(-1))
    .toMatchObject({ repositories: [{ repository: { name: "api" } }] });
  await writeFile(file(), '{\n "version": 1,\n "views": [}');
  await expect
    .poll(() => pushed.at(-1))
    .toMatchObject({
      settings: {
        status: "invalid",
        message: expect.stringMatching(/line 3, column/) as unknown,
      },
      repositories: [{ repository: { name: "api" } }],
    });
  const replacement = join(home, "replacement.json");
  await writeFile(
    replacement,
    JSON.stringify({ version: 1, repositories: [{ name: "acme/web" }] }),
  );
  await rename(replacement, file());
  await expect
    .poll(() => pushed.at(-1))
    .toMatchObject({
      settings: { status: "writable" },
      repositories: [{ repository: { name: "web" } }],
    });
});

it("resets a broken file by renaming it intact and publishes an empty writable sidebar", async () => {
  const broken = '{\n "version": 1,\n "views": [}';
  await writeFile(file(), broken);
  await core.getSidebar();
  expect(await core.resetSettings()).toEqual({ ok: true });
  const names = await readdir(home);
  const backup = names.find((name) => /^settings\.json\.broken-/.test(name));
  expect(backup).toBeDefined();
  if (!backup) throw new Error("Backup missing");
  expect(await readFile(join(home, backup), "utf8")).toBe(broken);
  expect(await core.getSidebar()).toMatchObject({
    settings: { status: "writable" },
    repositories: [],
    views: [],
  });
  expect(JSON.parse(await readFile(file(), "utf8"))).toEqual({
    version: 1,
    repositories: [],
    views: [],
  });
});

it("never overwrites an unreadable file and can preserve it with Reset", async () => {
  await mkdir(file());
  expect(await core.getSidebar()).toMatchObject({
    repositories: [],
    settings: { status: "invalid" },
  });
  expect(
    await core.reorderSidebar(repository("api"), { direction: "down" }),
  ).toMatchObject({ ok: false });
  expect((await stat(file())).isDirectory()).toBe(true);
  expect(await core.resetSettings()).toEqual({ ok: true });
  const backup = (await readdir(home)).find((name) =>
    name.startsWith("settings.json.broken-"),
  );
  if (!backup) throw new Error("Unreadable original was not preserved");
  expect((await stat(join(home, backup))).isDirectory()).toBe(true);
  expect(await core.getSidebar()).toMatchObject({
    settings: { status: "writable" },
    repositories: [],
  });
});

it("replaces the file atomically in its folder, leaving existing readers an intact original", async () => {
  const original = {
    version: 1,
    repositories: [{ name: "acme/api" }, { name: "acme/web" }],
  };
  await write(original);
  const reader = await open(file(), "r");
  try {
    await core.reorderSidebar(repository("web"), { direction: "up" });
    expect(await reader.readFile("utf8")).toBe(JSON.stringify(original));
    expect(JSON.parse(await readFile(file(), "utf8"))).toMatchObject({
      repositories: [{ name: "acme/web" }, { name: "acme/api" }],
    });
    expect(await readdir(home)).toEqual(["settings.json"]);
  } finally {
    await reader.close();
  }
});

it.each([
  [
    {
      version: 1,
      repositories: null,
      views: [{ id: "bugs", name: "Bugs", query: "bug" }],
    },
    "repositories",
  ],
  [
    {
      version: 1,
      repositories: [{ name: "acme/api" }, { name: "acme/web" }],
      views: null,
    },
    "views",
  ],
  [{ version: 1, typo: true }, "typo"],
  [
    { version: 1, repositories: [{ name: "acme/api", typo: true }] },
    "repositories[0].typo",
  ],
  [{ version: 1, views: [{ name: "Bugs", query: 2 }] }, "views[0].query"],
  [
    { version: 1, repositories: [{ name: "acme/api", id: "42" }] },
    "repositories[0].id",
  ],
  [
    {
      version: 1,
      views: [
        { id: "same", name: "Bugs", query: "bug" },
        { id: "same", name: "Work", query: "work" },
      ],
    },
    "views[1].id",
  ],
  [{ repositories: [] }, "version"],
])(
  "rejects invalid settings without changing the file (%s)",
  async (data, location) => {
    await write(data);
    expect(await core.getSidebar()).toMatchObject({
      settings: {
        status: "invalid",
        message: expect.stringContaining(location) as unknown,
      },
    });
    expect(
      await core.reorderSidebar(repository("api"), { direction: "up" }),
    ).toMatchObject({ ok: false });
    expect(await readFile(file(), "utf8")).toBe(JSON.stringify(data));
  },
);

it("identifies the actual syntax error before later lines and rejects comments and trailing commas", async () => {
  await writeFile(file(), '{\n "version": 1,\n "views": [}\n\n}');
  expect(await core.getSidebar()).toMatchObject({
    settings: {
      status: "invalid",
      message: expect.stringContaining("line 3, column 12") as unknown,
    },
  });
  for (const text of ['{"version":1,}', '{"version":1 /* comment */}']) {
    await writeFile(file(), text);
    expect(await core.getSidebar()).toMatchObject({
      settings: { status: "invalid" },
    });
  }
});

it("keeps each rapid move against the preceding write and rejects a move between sections", async () => {
  await write({
    version: 1,
    repositories: [
      { name: "acme/api" },
      { name: "acme/web" },
      { name: "acme/tools" },
    ],
    views: [{ id: "bugs", name: "Bugs", query: "bug" }],
  });
  await Promise.all([
    core.reorderSidebar(repository("tools"), { direction: "up" }),
    core.reorderSidebar(repository("tools"), { direction: "up" }),
  ]);
  expect(await core.getSidebar()).toMatchObject({
    repositories: [
      { repository: { name: "tools" } },
      { repository: { name: "api" } },
      { repository: { name: "web" } },
    ],
  });
  const before = await readFile(file(), "utf8");
  expect(
    await core.reorderSidebar(repository("tools"), {
      relativeTo: { kind: "view", id: "bugs" },
      side: "after",
    }),
  ).toMatchObject({ ok: false });
  expect(await readFile(file(), "utf8")).toBe(before);
});

it.skipIf(process.platform === "win32")(
  "does not treat a dangling settings symlink as a missing file",
  async () => {
    await symlink(join(home, "missing-target"), file());
    expect(await core.getSidebar()).toMatchObject({
      settings: { status: "invalid" },
    });
    expect(
      await core.reorderSidebar(repository("api"), { direction: "down" }),
    ).toMatchObject({ ok: false });
    expect((await lstat(file())).isSymbolicLink()).toBe(true);
  },
);
