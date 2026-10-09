import type { ConfigState, Setup, SidebarEntries } from "@verdandi/core";
import { afterEach, describe, expect, it } from "vitest";
import { createHost, type Host } from "./host.ts";
import type { GitHubOutcome, GitHubRequest } from "./native.ts";
import { useNative } from "./native.ts";
import { installPolyfills } from "./polyfills.ts";
import { createFakeNative, type FakeNative } from "./testing/fake-native.ts";

const home =
  "/var/mobile/Containers/Data/Application/A/Library/Application Support/Verdandi";

let started: { host: Host; native: FakeNative } | undefined;

/** Starts the host on a fake app, as the app starts it. */
function start(
  github: (request: GitHubRequest) => GitHubOutcome = () => ({
    kind: "response",
    status: 200,
    headers: [],
    body: JSON.stringify({ login: "octo-reader" }),
  }),
  { tokenSource = "stored" }: { tokenSource?: string } = {},
) {
  const native = createFakeNative({ github, tokenSource });
  useNative(native);
  installPolyfills();
  const host = createHost();
  native.attach(host);
  host.start(
    JSON.stringify({
      home,
      fonts: {
        interfaceFont: "SF Pro",
        codeFont: "SF Mono",
        installed: ["SF Pro", "SF Mono", "Menlo"],
      },
    }),
  );
  started = { host, native };
  return native;
}

afterEach(() => {
  started = undefined;
});

describe("the core on the iOS host", () => {
  it("is ready once GitHub names the token's account", async () => {
    const native = start();

    const setup = await native.request<Setup>("checkSetupAgain");

    expect(setup).toMatchObject({
      status: "ready",
      gh: { path: "/Verdandi/bin/gh" },
      account: {
        status: "known",
        account: { login: "octo-reader", host: "github.com" },
        tokenSource: "stored",
      },
    });
  });

  it("is blocked as signed out without a token", async () => {
    const native = start(undefined, { tokenSource: "" });

    expect(await native.request<Setup>("checkSetupAgain")).toMatchObject({
      status: "blocked",
      problem: { kind: "signed-out" },
    });
  });

  it("starts without settings.json, and Skip creates it in the app's folder", async () => {
    const native = start();

    const first = await native.request<SidebarEntries>("getSidebar");
    await native.request("skipRepositoryPicker");
    const second = await native.request<SidebarEntries>("getSidebar");

    expect(first).toMatchObject({ status: "read", firstLaunch: true });
    expect(second).toMatchObject({ status: "read", firstLaunch: false });
    const settings = native.files.get(`${home}/settings.json`);
    expect(settings?.type === "file" && JSON.parse(settings.text)).toEqual({
      version: 1,
      repositories: [],
      views: [],
    });
  });

  it("writes config.toml whole, and pushes the change", async () => {
    const native = start();

    await native.request("changeConfig", { appearance: "dark" });
    const config = await native.request<ConfigState>("getConfig");

    expect(config).toMatchObject({
      status: "read",
      config: { appearance: "dark", interfaceFont: null },
      problems: [],
    });
    const file = native.files.get(`${home}/config.toml`);
    expect(file?.type === "file" && file.text).toContain('appearance = "dark"');
    expect(
      [...native.files.keys()].filter((path) => path.endsWith(".tmp")),
    ).toEqual([]);
    expect(native.events.map(({ name }) => name)).toContain("configChanged");
  });

  it("keeps the recent issues in its machine-local state", async () => {
    const native = start();
    const issue = {
      id: "I_1",
      repository: { owner: "octo", name: "one" },
      number: 12,
      title: "Make it fly",
    };

    await native.request("recordRecentIssue", issue);

    expect(await native.request("getRecentIssues")).toEqual([issue]);
    expect(native.files.has(`${home}/desktop/state.json`)).toBe(true);
  });

  it("fails a request it does not know", async () => {
    const native = start();

    await expect(native.request("deleteEverything")).rejects.toThrow(
      "Unknown request: deleteEverything",
    );
    expect(started).toBeDefined();
  });
});
