import { describe, expect, it } from "vitest";
import { desktopStateDirectory, userDataDirectory } from "./directories.ts";

describe("user data directory", () => {
  it("is in Application Support on macOS", () => {
    expect(
      userDataDirectory({
        platform: "darwin",
        env: {},
        homedir: "/Users/octo",
      }),
    ).toBe("/Users/octo/Library/Application Support/Verdandi");
  });

  it("is in the roaming app data on Windows", () => {
    expect(
      userDataDirectory({
        platform: "win32",
        env: {
          APPDATA: "C:\\Users\\octo\\AppData\\Roaming",
          LOCALAPPDATA: "C:\\Users\\octo\\AppData\\Local",
        },
        homedir: "C:\\Users\\octo",
      }),
    ).toBe("C:\\Users\\octo\\AppData\\Roaming\\Verdandi");
  });

  it("is in AppData\\Roaming on Windows without APPDATA", () => {
    expect(
      userDataDirectory({
        platform: "win32",
        env: {},
        homedir: "C:\\Users\\octo",
      }),
    ).toBe("C:\\Users\\octo\\AppData\\Roaming\\Verdandi");
  });

  it("is in XDG_DATA_HOME on Linux", () => {
    expect(
      userDataDirectory({
        platform: "linux",
        env: { XDG_DATA_HOME: "/var/data/octo" },
        homedir: "/home/octo",
      }),
    ).toBe("/var/data/octo/verdandi");
  });

  it("is in ~/.local/share on Linux without XDG_DATA_HOME", () => {
    expect(
      userDataDirectory({
        platform: "linux",
        env: { XDG_DATA_HOME: "" },
        homedir: "/home/octo",
      }),
    ).toBe("/home/octo/.local/share/verdandi");
  });

  it("ignores a relative XDG_DATA_HOME on Linux", () => {
    expect(
      userDataDirectory({
        platform: "linux",
        env: { XDG_DATA_HOME: "data" },
        homedir: "/home/octo",
      }),
    ).toBe("/home/octo/.local/share/verdandi");
  });

  it("is VERDANDI_HOME when it is set", () => {
    expect(
      userDataDirectory({
        platform: "linux",
        env: {
          VERDANDI_HOME: "/tmp/verdandi-test",
          XDG_DATA_HOME: "/var/data/octo",
        },
        homedir: "/home/octo",
      }),
    ).toBe("/tmp/verdandi-test");
  });
});

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
