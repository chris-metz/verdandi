import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { configDirectory } from "../directories.ts";
import { testFonts } from "../testing/fonts.ts";
import { testThemes } from "../testing/themes.ts";
import { createConfigFile } from "./config-file.ts";

it("watches for its folder without creating it, and sees the file once it is made", async () => {
  const root = await mkdtemp(join(tmpdir(), "verdandi-config-folder-"));
  const host = {
    platform: process.platform,
    env: {
      XDG_CONFIG_HOME: join(root, "config"),
      APPDATA: join(root, "roaming"),
    },
    homedir: root,
  };
  const folder = configDirectory(host);
  const storage = createConfigFile(host, testThemes, testFonts);
  let changes = 0;
  const stop = storage.watch(() => {
    changes++;
  });
  try {
    expect(await storage.read()).toMatchObject({ status: "missing" });
    expect(existsSync(folder)).toBe(false);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "config.toml"), 'appearance = "dark"');
    await expect.poll(() => changes).toBeGreaterThan(0);
    expect(await storage.read()).toMatchObject({
      status: "read",
      config: { appearance: "dark" },
    });
  } finally {
    stop();
    await rm(root, { recursive: true, force: true });
  }
});

it("creates its folder with the first change", async () => {
  const root = await mkdtemp(join(tmpdir(), "verdandi-config-folder-"));
  const host = {
    platform: process.platform,
    env: {
      XDG_CONFIG_HOME: join(root, "config"),
      APPDATA: join(root, "roaming"),
    },
    homedir: root,
  };
  const storage = createConfigFile(host, testThemes, testFonts);
  try {
    expect(await storage.change({ lightTheme: "github-light" })).toEqual({
      ok: true,
    });
    expect(
      await readFile(join(configDirectory(host), "config.toml"), "utf8"),
    ).toBe('light_theme = "github-light"\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
