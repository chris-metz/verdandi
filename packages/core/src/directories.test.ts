import { describe, expect, it } from "vitest";
import { desktopStateDirectory } from "./directories.ts";

describe("desktop state directory", () => {
  it("is in Application Support on macOS", () => {
    expect(
      desktopStateDirectory({
        platform: "darwin",
        env: {},
        homedir: "/Users/octo",
      }),
    ).toBe("/Users/octo/Library/Application Support/Verdandi/desktop");
  });

  it("is in the local, non-roaming app data on Windows", () => {
    expect(
      desktopStateDirectory({
        platform: "win32",
        env: {
          APPDATA: "C:\\Users\\octo\\AppData\\Roaming",
          LOCALAPPDATA: "C:\\Users\\octo\\AppData\\Local",
        },
        homedir: "C:\\Users\\octo",
      }),
    ).toBe("C:\\Users\\octo\\AppData\\Local\\Verdandi\\desktop");
  });

  it("is in XDG_STATE_HOME on Linux", () => {
    expect(
      desktopStateDirectory({
        platform: "linux",
        env: { XDG_STATE_HOME: "/var/state/octo" },
        homedir: "/home/octo",
      }),
    ).toBe("/var/state/octo/verdandi/desktop");
  });

  it("is in ~/.local/state on Linux without XDG_STATE_HOME", () => {
    expect(
      desktopStateDirectory({
        platform: "linux",
        env: { XDG_STATE_HOME: "" },
        homedir: "/home/octo",
      }),
    ).toBe("/home/octo/.local/state/verdandi/desktop");
  });

  it("is below VERDANDI_HOME when it is set", () => {
    expect(
      desktopStateDirectory({
        platform: "linux",
        env: {
          VERDANDI_HOME: "/tmp/verdandi-test",
          XDG_STATE_HOME: "/var/state/octo",
        },
        homedir: "/home/octo",
      }),
    ).toBe("/tmp/verdandi-test/desktop");
  });
});
