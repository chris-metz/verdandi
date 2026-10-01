import type { Config, ConfigState } from "@verdandi/core/contract";
import { beforeEach, describe, expect, it } from "vitest";
import type { RendererContract } from "../../shared/ipc";
import { githubDark, githubLight } from "../../shared/themes/github";
import { followAppearance, showTheme } from "./theme";

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement("html");
});

describe("showTheme", () => {
  it("shows every colour of the theme on the page", () => {
    showTheme(root, githubDark);
    expect(root.style.getPropertyValue("--background")).toBe("#0d1117");
    expect(root.style.getPropertyValue("--issue-open")).toBe("#3fb950");
    expect(root.style.getPropertyValue("--pl-keyword")).toBe("#ff7b72");
    expect(root.dataset.theme).toBe("github-dark");
  });

  it("marks the page dark for a dark theme, and light for a light one", () => {
    showTheme(root, githubDark);
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
    showTheme(root, githubLight);
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.style.colorScheme).toBe("light");
    expect(root.style.getPropertyValue("--background")).toBe("#ffffff");
  });
});

describe("followAppearance", () => {
  function systemAppearance(dark: boolean) {
    const media = Object.assign(new EventTarget(), { matches: dark });
    return {
      media,
      switchTo(next: boolean) {
        media.matches = next;
        media.dispatchEvent(new Event("change"));
      },
    };
  }

  /** The core's side: `config.toml` as read at first, then its changes. */
  function configFile(config: Partial<Config> = {}) {
    let listener: ((state: ConfigState) => void) | undefined;
    let answer!: (state: ConfigState) => void;
    let fail!: (error: Error) => void;
    const state = (next: Partial<Config>): ConfigState => ({
      config: {
        appearance: "system",
        lightTheme: "github-light",
        darkTheme: "github-dark",
        ...next,
      },
      file: "/home/octo/.config/verdandi/config.toml",
      status: "read",
      problems: [],
    });
    const read = new Promise<ConfigState>((resolve, reject) => {
      answer = resolve;
      fail = reject;
    });
    return {
      verdandi: {
        getConfig: () => read,
        on: ((_: "configChanged", next: (state: ConfigState) => void) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        }) as Pick<RendererContract, "on">["on"],
      },
      answer: () => {
        answer(state(config));
      },
      fail: () => {
        fail(new Error("No core"));
      },
      change(next: Partial<Config>) {
        listener?.(state(next));
      },
    };
  }

  it("shows nothing until the configuration is read, then its theme for the appearance", async () => {
    const file = configFile({ darkTheme: "github-dark-dimmed" });
    const { ready } = followAppearance(
      root,
      systemAppearance(true).media,
      file.verdandi,
    );
    expect(root.dataset.theme).toBeUndefined();
    file.answer();
    await ready;
    expect(root.dataset.theme).toBe("github-dark-dimmed");
  });

  it("shows the default theme when the configuration cannot be read", async () => {
    const file = configFile();
    const { ready } = followAppearance(
      root,
      systemAppearance(true).media,
      file.verdandi,
    );
    file.fail();
    await ready;
    expect(root.dataset.theme).toBe("github-dark");
  });

  it("switches at once when the appearance does", async () => {
    const system = systemAppearance(false);
    const file = configFile({ darkTheme: "github-dark-dimmed" });
    const { ready } = followAppearance(root, system.media, file.verdandi);
    file.answer();
    await ready;
    expect(root.dataset.theme).toBe("github-light");
    system.switchTo(true);
    expect(root.dataset.theme).toBe("github-dark-dimmed");
  });

  it("switches at once when the chosen theme changes", async () => {
    const file = configFile();
    const { ready } = followAppearance(
      root,
      systemAppearance(true).media,
      file.verdandi,
    );
    file.answer();
    await ready;
    file.change({ darkTheme: "github-dark-dimmed" });
    expect(root.dataset.theme).toBe("github-dark-dimmed");
  });

  it("keeps a change that arrives before the first read", async () => {
    const file = configFile();
    const { ready } = followAppearance(
      root,
      systemAppearance(true).media,
      file.verdandi,
    );
    file.change({ darkTheme: "github-dark-dimmed" });
    file.answer();
    await ready;
    expect(root.dataset.theme).toBe("github-dark-dimmed");
  });

  it("stops following once told to", async () => {
    const system = systemAppearance(false);
    const file = configFile();
    const { ready, stop } = followAppearance(root, system.media, file.verdandi);
    file.answer();
    await ready;
    stop();
    system.switchTo(true);
    file.change({ darkTheme: "github-dark-dimmed" });
    expect(root.dataset.theme).toBe("github-light");
  });
});
