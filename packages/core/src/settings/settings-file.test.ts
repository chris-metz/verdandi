import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createSettingsFile } from "./settings-file.ts";

it.each(["EPERM", "EBUSY"])(
  "retries an atomic replacement temporarily blocked with %s",
  async (code) => {
    const home = await mkdtemp(join(tmpdir(), "verdandi-retry-"));
    try {
      const file = join(home, "settings.json");
      await writeFile(
        file,
        JSON.stringify({
          version: 1,
          repositories: [{ name: "acme/api" }, { name: "acme/web" }],
        }),
      );
      let blocked = 2;
      const store = createSettingsFile(
        {
          platform: process.platform,
          env: { VERDANDI_HOME: home },
          homedir: home,
        },
        {
          rename: async (from, to) => {
            if (blocked-- > 0)
              throw Object.assign(new Error("File held by another process"), {
                code,
              });
            await rename(from, to);
          },
        },
      );
      expect(
        await store.reorder(
          { kind: "repository", repository: { owner: "acme", name: "web" } },
          { direction: "up" },
        ),
      ).toEqual({ ok: true });
      expect(blocked).toBeLessThan(1);
      expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
        repositories: [{ name: "acme/web" }, { name: "acme/api" }],
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);

it.each(["EBUSY", "EACCES"])(
  "leaves the original intact and cleans up when replacement keeps failing with %s",
  async (code) => {
    const home = await mkdtemp(join(tmpdir(), "verdandi-retry-"));
    try {
      const file = join(home, "settings.json");
      const original = JSON.stringify({
        version: 1,
        repositories: [{ name: "acme/api" }, { name: "acme/web" }],
      });
      await writeFile(file, original);
      const store = createSettingsFile(
        {
          platform: process.platform,
          env: { VERDANDI_HOME: home },
          homedir: home,
        },
        {
          rename: () =>
            Promise.reject(
              Object.assign(new Error("Replacement blocked"), { code }),
            ),
        },
      );
      expect(
        await store.reorder(
          { kind: "repository", repository: { owner: "acme", name: "web" } },
          { direction: "up" },
        ),
      ).toEqual({ ok: false, message: "Replacement blocked" });
      expect(await readFile(file, "utf8")).toBe(original);
      expect(await readdir(home)).toEqual(["settings.json"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
