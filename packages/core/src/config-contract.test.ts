import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { Appearance, ConfigState } from "./contract.ts";
import { createCore } from "./core.ts";
import { createConfigFile } from "./settings/config-file.ts";
import { createLocalStateFile } from "./settings/local-state-file.ts";
import { createSettingsFile } from "./settings/settings-file.ts";
import { createFakeGitHub } from "./testing/fake-github.ts";
import { testThemes } from "./testing/themes.ts";

const defaults = {
  appearance: "system",
  lightTheme: "github-light",
  darkTheme: "github-dark",
};

// One core for every test, as the app has one: a new watcher on macOS misses
// what changes while it starts.
let home: string;
let core: ReturnType<typeof createCore>;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "verdandi-config-"));
  const host = {
    platform: process.platform,
    env: { VERDANDI_HOME: home },
    homedir: home,
  };
  core = createCore({
    host,
    settings: createSettingsFile(host),
    localState: createLocalStateFile(host),
    config: createConfigFile(host, testThemes),
    github: () => createFakeGitHub({ login: "octo-reader" }),
    runCommand: () => Promise.resolve({ kind: "not-found" }),
  });
});
beforeEach(() => rm(file(), { recursive: true, force: true }));
afterAll(async () => {
  core.dispose();
  await rm(home, { recursive: true, force: true });
});
const file = () => join(home, "config.toml");
const write = (text: string) => writeFile(file(), text);
const read = () => readFile(file(), "utf8");

it("uses every default without a file, and does not create it", async () => {
  expect(await core.getConfig()).toEqual({
    config: defaults,
    file: file(),
    status: "missing",
    problems: [],
  });
  expect(await readdir(home)).not.toContain("config.toml");
});

it("reads every key", async () => {
  await write(
    [
      "# How Verdandi looks",
      'appearance = "dark"',
      'light_theme = "github-light"',
      'dark_theme = "github-dark-dimmed"',
      "",
    ].join("\n"),
  );
  expect(await core.getConfig()).toEqual({
    config: {
      appearance: "dark",
      lightTheme: "github-light",
      darkTheme: "github-dark-dimmed",
    },
    file: file(),
    status: "read",
    problems: [],
  });
});

it.each([
  ['appearance = "system"', { appearance: "system" }],
  ['appearance = "light"', { appearance: "light" }],
  ['appearance = "dark"', { appearance: "dark" }],
  ['light_theme = "github-light"', { lightTheme: "github-light" }],
  ['dark_theme = "github-dark-dimmed"', { darkTheme: "github-dark-dimmed" }],
  ["", {}],
])("reads %j, with defaults for the other keys", async (text, config) => {
  await write(text);
  expect(await core.getConfig()).toMatchObject({
    config: { ...defaults, ...config },
    status: "read",
    problems: [],
  });
});

it.each([
  [
    "an unknown theme",
    'dark_theme = "solarized"',
    "dark_theme",
    'config.toml, line 2: dark_theme is "solarized", which is not a theme. Verdandi uses "github-dark" instead.',
  ],
  [
    "a dark theme as the light theme",
    'light_theme = "github-dark-dimmed"',
    "light_theme",
    'config.toml, line 2: light_theme is "github-dark-dimmed", which is a dark theme. Verdandi uses "github-light" instead.',
  ],
  [
    "a light theme as the dark theme",
    'dark_theme = "github-light"',
    "dark_theme",
    'config.toml, line 2: dark_theme is "github-light", which is a light theme. Verdandi uses "github-dark" instead.',
  ],
  [
    "an appearance other than the three",
    'appearance = "auto"',
    "appearance",
    'config.toml, line 2: appearance is "auto", but can only be "system", "light" or "dark". Verdandi uses "system" instead.',
  ],
  [
    "an appearance of the wrong type",
    "appearance = true",
    "appearance",
    'config.toml, line 2: appearance is true, but can only be "system", "light" or "dark". Verdandi uses "system" instead.',
  ],
  [
    "a theme of the wrong type",
    "light_theme = 3",
    "light_theme",
    'config.toml, line 2: light_theme is 3, but must be the ID of a light theme, in quotes. Verdandi uses "github-light" instead.',
  ],
  [
    "a theme given as a list",
    'dark_theme = ["github-dark"]',
    "dark_theme",
    'config.toml, line 2: dark_theme is a list, but must be the ID of a dark theme, in quotes. Verdandi uses "github-dark" instead.',
  ],
])(
  "falls back to the default for %s, and still uses the other values",
  async (_, line, key, message) => {
    const others = {
      appearance: "light",
      lightTheme: "github-light",
      darkTheme: "github-dark-dimmed",
    };
    const text = [
      "# Verdandi",
      line,
      ...(key === "appearance" ? [] : ['appearance = "light"']),
      ...(key === "dark_theme" ? [] : ['dark_theme = "github-dark-dimmed"']),
    ];
    await write(text.join("\n"));
    const state = await core.getConfig();
    const fallback = {
      appearance: { appearance: "system" },
      light_theme: { lightTheme: "github-light" },
      dark_theme: { darkTheme: "github-dark" },
    }[key];
    expect(state).toMatchObject({
      config: { ...others, ...fallback },
      status: "read",
    });
    expect(state.problems).toEqual([{ key, line: 2, message }]);
  },
);

it("falls back to the default for a key given as a table", async () => {
  await write('light_theme = "github-light"\n[appearance]\nmode = "dark"');
  expect(await core.getConfig()).toMatchObject({
    config: defaults,
    problems: [
      {
        key: "appearance",
        line: 2,
        message:
          'config.toml, line 2: appearance is a table, but can only be "system", "light" or "dark". Verdandi uses "system" instead.',
      },
    ],
  });
});

it("ignores an unknown key and reports it, in the file's order", async () => {
  await write(
    [
      'appearance = "dark"',
      'dark_them = "github-dark-dimmed"',
      'light_theme = "no-such-theme"',
      "[fonts]",
      'code = "Menlo"',
    ].join("\n"),
  );
  expect(await core.getConfig()).toEqual({
    config: { ...defaults, appearance: "dark" },
    file: file(),
    status: "read",
    problems: [
      {
        key: "dark_them",
        line: 2,
        message:
          "config.toml, line 2: Verdandi does not know the key dark_them, and ignores it.",
      },
      {
        key: "light_theme",
        line: 3,
        message:
          'config.toml, line 3: light_theme is "no-such-theme", which is not a theme. Verdandi uses "github-light" instead.',
      },
      {
        key: "fonts",
        line: 4,
        message:
          "config.toml, line 4: Verdandi does not know the key fonts, and ignores it.",
      },
    ],
  });
});

it("uses every default when the file is not valid TOML", async () => {
  await write('appearance = "dark"\ndark_theme = \n');
  expect(await core.getConfig()).toEqual({
    config: defaults,
    file: file(),
    status: "unreadable",
    problems: [
      {
        line: 2,
        message:
          "config.toml, line 2, is not valid TOML: Expected value, reached EOF. Verdandi uses every default until it is fixed.",
      },
    ],
  });
});

it("uses every default when the file cannot be read", async () => {
  await mkdir(file());
  expect(await core.getConfig()).toMatchObject({
    config: defaults,
    status: "unreadable",
    problems: [
      {
        message: expect.stringMatching(
          /^Cannot read config\.toml: .+\. Verdandi uses every default until it can\.$/,
        ) as unknown,
      },
    ],
  });
});

it("pushes each change to the file: created, fixed, replaced and deleted", async () => {
  await core.getConfig();
  const pushed: ConfigState[] = [];
  core.on("configChanged", (state) => pushed.push(state));

  // A text no other test writes: macOS may report this write together with
  // the deletion before it, and an earlier test's text would look unchanged.
  await write('# Created\ndark_theme = "github-dark-dimmed"');
  await expect
    .poll(() => pushed.at(-1))
    .toMatchObject({
      status: "read",
      config: { darkTheme: "github-dark-dimmed" },
    });

  await write('dark_theme = "dimmed"');
  await expect
    .poll(() => pushed.at(-1))
    .toMatchObject({
      config: { darkTheme: "github-dark" },
      problems: [{ key: "dark_theme" }],
    });

  await write("appearance = ");
  await expect
    .poll(() => pushed.at(-1))
    .toMatchObject({ status: "unreadable", config: defaults });

  const replacement = join(home, "config.toml.new");
  await writeFile(replacement, 'appearance = "light"');
  await rename(replacement, file());
  await expect
    .poll(() => pushed.at(-1))
    .toEqual({
      config: { ...defaults, appearance: "light" },
      file: file(),
      status: "read",
      problems: [],
    });

  await rm(file());
  await expect
    .poll(() => pushed.at(-1))
    .toEqual({
      config: defaults,
      file: file(),
      status: "missing",
      problems: [],
    });
});

it("writes a change into the file, keeping everything else in it as it was", async () => {
  await write(
    [
      "# How Verdandi looks",
      'appearance = "dark"   # at night too',
      "",
      "# Themes",
      "light_theme = 'github-light'",
      "",
      "[fonts]",
      'code = "Menlo"',
      "",
    ].join("\r\n"),
  );
  expect(await core.changeConfig({ appearance: "light" })).toEqual({
    ok: true,
  });
  expect(await read()).toBe(
    [
      "# How Verdandi looks",
      'appearance = "light"   # at night too',
      "",
      "# Themes",
      "light_theme = 'github-light'",
      "",
      "[fonts]",
      'code = "Menlo"',
      "",
    ].join("\r\n"),
  );
});

it("pushes the changed file at once", async () => {
  await write('appearance = "dark"\n');
  await core.getConfig();
  const pushed: ConfigState[] = [];
  const stop = core.on("configChanged", (state) => pushed.push(state));
  try {
    await core.changeConfig({ lightTheme: "github-light" });
    expect(pushed.at(-1)).toEqual({
      config: { ...defaults, appearance: "dark" },
      file: file(),
      status: "read",
      problems: [],
    });
    await core.changeConfig({ darkTheme: "github-dark-dimmed" });
    expect(pushed.at(-1)).toMatchObject({
      config: { darkTheme: "github-dark-dimmed" },
    });
  } finally {
    stop();
  }
});

it("adds a key the file does not have with the others, before any table", async () => {
  await write(
    [
      "# How Verdandi looks",
      'appearance = "dark"',
      "",
      "[fonts]",
      'code = "Menlo"',
      "",
    ].join("\n"),
  );
  expect(await core.changeConfig({ darkTheme: "github-dark-dimmed" })).toEqual({
    ok: true,
  });
  expect(await read()).toBe(
    [
      "# How Verdandi looks",
      'appearance = "dark"',
      'dark_theme = "github-dark-dimmed"',
      "",
      "[fonts]",
      'code = "Menlo"',
      "",
    ].join("\n"),
  );
});

it("creates the file holding only the key changed", async () => {
  expect(await core.changeConfig({ appearance: "dark" })).toEqual({
    ok: true,
  });
  expect(await read()).toBe('appearance = "dark"\n');
  expect(await core.getConfig()).toMatchObject({
    config: { ...defaults, appearance: "dark" },
    status: "read",
  });
});

it("writes nothing while the file is not valid TOML", async () => {
  const text = 'appearance = "dark"\ndark_theme = \n';
  await write(text);
  expect(await core.changeConfig({ darkTheme: "github-dark-dimmed" })).toEqual({
    ok: false,
    message:
      "config.toml, line 2, is not valid TOML: Expected value, reached EOF. Nothing is written to it until it is fixed.",
  });
  expect(await read()).toBe(text);
});

it("writes nothing while the file cannot be read", async () => {
  await mkdir(file());
  expect(await core.changeConfig({ appearance: "dark" })).toEqual({
    ok: false,
    message: expect.stringMatching(
      /^Cannot read config\.toml: .+\. Nothing is written to it until it can be\.$/,
    ) as unknown,
  });
  expect(await readdir(file())).toEqual([]);
});

it("replaces a value that cannot be used", async () => {
  await write('dark_theme = "solarized" # from another app\n');
  expect(await core.changeConfig({ darkTheme: "github-dark-dimmed" })).toEqual({
    ok: true,
  });
  expect(await read()).toBe(
    'dark_theme = "github-dark-dimmed" # from another app\n',
  );
  expect(await core.getConfig()).toMatchObject({
    config: { darkTheme: "github-dark-dimmed" },
    problems: [],
  });
});

it.each([
  [
    { darkTheme: "github-light" },
    'dark_theme is "github-light", which is a light theme. Nothing was written.',
  ],
  [
    { lightTheme: "solarized" },
    'light_theme is "solarized", which is not a theme. Nothing was written.',
  ],
  [
    { appearance: "auto" as Appearance },
    'appearance is "auto", but can only be "system", "light" or "dark". Nothing was written.',
  ],
])("writes nothing it could not use itself: %j", async (change, message) => {
  const text = 'appearance = "dark"\n';
  await write(text);
  expect(await core.changeConfig(change)).toEqual({ ok: false, message });
  expect(await read()).toBe(text);
});

it("writes through a link to the file, which stays a link", async () => {
  const dotfiles = join(home, "dotfiles");
  await mkdir(dotfiles, { recursive: true });
  const target = join(dotfiles, "verdandi.toml");
  await writeFile(target, 'appearance = "dark"\n');
  await symlink(target, file());
  expect(await core.changeConfig({ appearance: "light" })).toEqual({
    ok: true,
  });
  expect((await lstat(file())).isSymbolicLink()).toBe(true);
  expect(await readFile(target, "utf8")).toBe('appearance = "light"\n');
});

it.skipIf(process.platform === "win32")(
  "keeps who may read the file",
  async () => {
    await write('appearance = "dark"\n');
    await chmod(file(), 0o600);
    await core.changeConfig({ appearance: "light" });
    expect((await stat(file())).mode & 0o777).toBe(0o600);
  },
);

it("leaves the file alone when it has the value already", async () => {
  await write('appearance = "dark"\n');
  const before = await stat(file());
  expect(await core.changeConfig({ appearance: "dark" })).toEqual({
    ok: true,
  });
  expect((await stat(file())).ino).toBe(before.ino);
});
