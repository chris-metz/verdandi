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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Appearance, ConfigState } from "./contract.ts";
import { createCore } from "./core.ts";
import { createConfigFile } from "./settings/config-file.ts";
import { createLocalStateFile } from "./settings/local-state-file.ts";
import { createSettingsFile } from "./settings/settings-file.ts";
import { createFakeGitHub } from "./testing/fake-github.ts";
import { testFonts } from "./testing/fonts.ts";
import { testThemes } from "./testing/themes.ts";

const defaults = {
  appearance: "system",
  lightTheme: "github-light",
  darkTheme: "github-dark",
  interfaceFont: null,
  codeFont: null,
};

/** A core with its files under `home`. */
function createTestCore(home: string) {
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
  });
}

// One core for every test, as the app has one: a new watcher on macOS misses
// what changes while it starts. It is never told which font families are
// installed.
let home: string;
let core: ReturnType<typeof createCore>;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "verdandi-config-"));
  core = createTestCore(home);
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
      'font = "Inter"',
      'code_font = "JetBrains Mono"',
      "",
    ].join("\n"),
  );
  expect(await core.getConfig()).toEqual({
    config: {
      appearance: "dark",
      lightTheme: "github-light",
      darkTheme: "github-dark-dimmed",
      interfaceFont: "Inter",
      codeFont: "JetBrains Mono",
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
  ['font = "Inter"', { interfaceFont: "Inter" }],
  ['code_font = "JetBrains Mono"', { codeFont: "JetBrains Mono" }],
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
  [
    "a font of the wrong type",
    "font = 14",
    "font",
    'config.toml, line 2: font is 14, but must be the name of a font family, in quotes. Verdandi uses "Geist" instead.',
  ],
  [
    "a code font given as a list",
    'code_font = ["JetBrains Mono", "Menlo"]',
    "code_font",
    'config.toml, line 2: code_font is a list, but must be the name of a font family, in quotes. Verdandi uses "Geist Mono" instead.',
  ],
  [
    "a font without a name",
    'font = " "',
    "font",
    'config.toml, line 2: font is " ", but must be the name of a font family, in quotes. Verdandi uses "Geist" instead.',
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
      font: { interfaceFont: null },
      code_font: { codeFont: null },
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

it("writes a font under its key, and removes the key for the default, keeping everything else", async () => {
  await write(
    [
      "# How Verdandi looks",
      'appearance = "dark"   # at night too',
      "",
      "# Fonts",
      'font = "Inter" # mine',
      "",
      "[fonts]",
      'code = "Menlo"',
      "",
    ].join("\r\n"),
  );
  expect(await core.changeConfig({ codeFont: "JetBrains Mono" })).toEqual({
    ok: true,
  });
  expect(await read()).toBe(
    [
      "# How Verdandi looks",
      'appearance = "dark"   # at night too',
      "",
      "# Fonts",
      'font = "Inter" # mine',
      'code_font = "JetBrains Mono"',
      "",
      "[fonts]",
      'code = "Menlo"',
      "",
    ].join("\r\n"),
  );
  expect(await core.changeConfig({ interfaceFont: null })).toEqual({
    ok: true,
  });
  expect(await read()).toBe(
    [
      "# How Verdandi looks",
      'appearance = "dark"   # at night too',
      "",
      "# Fonts",
      'code_font = "JetBrains Mono"',
      "",
      "[fonts]",
      'code = "Menlo"',
      "",
    ].join("\r\n"),
  );
  expect(await core.getConfig()).toMatchObject({
    config: { interfaceFont: null, codeFont: "JetBrains Mono" },
    problems: [{ key: "fonts" }],
  });
});

it("removes a font that cannot be used, for the default", async () => {
  await write('appearance = "dark"\ncode_font = 14\n');
  expect(await core.changeConfig({ codeFont: null })).toEqual({ ok: true });
  expect(await read()).toBe('appearance = "dark"\n');
});

it("creates no file for a default font", async () => {
  expect(
    await core.changeConfig({ interfaceFont: null, codeFont: null }),
  ).toEqual({
    ok: true,
  });
  expect(await readdir(home)).not.toContain("config.toml");
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
  [
    { interfaceFont: "" },
    'font is "", but must be the name of a font family, in quotes. Nothing was written.',
  ],
  [
    { appearance: null as unknown as Appearance },
    'appearance is null, but can only be "system", "light" or "dark". Nothing was written.',
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

describe("with the installed font families", () => {
  const installed = ["Geist", "Geist Mono", "Inter", "JetBrains Mono"];
  // A core of its own, as the families stay once told.
  let fontHome: string;
  let fontCore: ReturnType<typeof createCore>;
  beforeAll(async () => {
    fontHome = await mkdtemp(join(tmpdir(), "verdandi-config-fonts-"));
    fontCore = createTestCore(fontHome);
    await fontCore.setInstalledFonts(installed);
  });
  beforeEach(() =>
    rm(join(fontHome, "config.toml"), { recursive: true, force: true }),
  );
  afterAll(async () => {
    fontCore.dispose();
    await rm(fontHome, { recursive: true, force: true });
  });
  const writeFonts = (text: string) =>
    writeFile(join(fontHome, "config.toml"), text);

  it("falls back to the default for a family that is not installed, and says a restart finds one installed since", async () => {
    await writeFonts(
      [
        'font = "Comic Neue"',
        'code_font = "Fira Code" # from my laptop',
        'appearance = "dark"',
      ].join("\n"),
    );
    expect(await fontCore.getConfig()).toMatchObject({
      config: { ...defaults, appearance: "dark" },
      status: "read",
      problems: [
        {
          key: "font",
          line: 1,
          missingFont: "Comic Neue",
          message:
            'config.toml, line 1: font is "Comic Neue", which is not installed. Verdandi uses "Geist" instead. If you installed it since Verdandi started, restart Verdandi.',
        },
        {
          key: "code_font",
          line: 2,
          missingFont: "Fira Code",
          message:
            'config.toml, line 2: code_font is "Fira Code", which is not installed. Verdandi uses "Geist Mono" instead. If you installed it since Verdandi started, restart Verdandi.',
        },
      ],
    });
  });

  it("finds a family whatever its case, and uses its installed name", async () => {
    await writeFonts('font = "inter"\ncode_font = "JETBRAINS MONO"\n');
    expect(await fontCore.getConfig()).toMatchObject({
      config: {
        ...defaults,
        interfaceFont: "Inter",
        codeFont: "JetBrains Mono",
      },
      problems: [],
    });
  });

  it("writes an installed family, but none that is not installed", async () => {
    const text = 'appearance = "dark"\n';
    await writeFonts(text);
    expect(
      await fontCore.changeConfig({ interfaceFont: "Comic Neue" }),
    ).toEqual({
      ok: false,
      message:
        'font is "Comic Neue", which is not installed. Nothing was written.',
    });
    expect(await readFile(join(fontHome, "config.toml"), "utf8")).toBe(text);
    expect(await fontCore.changeConfig({ codeFont: "JetBrains Mono" })).toEqual(
      { ok: true },
    );
    expect(await readFile(join(fontHome, "config.toml"), "utf8")).toBe(
      'appearance = "dark"\ncode_font = "JetBrains Mono"\n',
    );
  });

  it("still names a value of the wrong type as such", async () => {
    await writeFonts("font = 14\n");
    expect(await fontCore.getConfig()).toMatchObject({
      config: defaults,
      problems: [
        {
          key: "font",
          message:
            'config.toml, line 1: font is 14, but must be the name of a font family, in quotes. Verdandi uses "Geist" instead.',
        },
      ],
    });
  });
});

it("checks the fonts once told which families are installed, and pushes the result", async () => {
  // A core of its own, as the families stay once told.
  const ownHome = await mkdtemp(join(tmpdir(), "verdandi-config-told-"));
  const ownCore = createTestCore(ownHome);
  try {
    await writeFile(
      join(ownHome, "config.toml"),
      'font = "Comic Neue"\ncode_font = "Menlo"\n',
    );
    expect(await ownCore.getConfig()).toMatchObject({
      config: { interfaceFont: "Comic Neue", codeFont: "Menlo" },
      problems: [],
    });
    const pushed: ConfigState[] = [];
    ownCore.on("configChanged", (state) => pushed.push(state));
    await ownCore.setInstalledFonts(["Geist", "Geist Mono", "Menlo"]);
    expect(pushed.at(-1)).toMatchObject({
      config: { interfaceFont: null, codeFont: "Menlo" },
      problems: [{ key: "font", missingFont: "Comic Neue" }],
    });
  } finally {
    ownCore.dispose();
    await rm(ownHome, { recursive: true, force: true });
  }
});
