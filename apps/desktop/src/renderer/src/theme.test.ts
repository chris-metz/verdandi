import { beforeEach, describe, expect, it } from "vitest";
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

  it("shows the theme for the operating system's appearance", () => {
    const { media } = systemAppearance(true);
    followAppearance(root, media);
    expect(root.dataset.theme).toBe("github-dark");
  });

  it("switches at once when the operating system does", () => {
    const system = systemAppearance(false);
    followAppearance(root, system.media);
    expect(root.dataset.theme).toBe("github-light");
    system.switchTo(true);
    expect(root.dataset.theme).toBe("github-dark");
  });

  it("stops following once told to", () => {
    const system = systemAppearance(false);
    const stop = followAppearance(root, system.media);
    stop();
    system.switchTo(true);
    expect(root.dataset.theme).toBe("github-light");
  });
});
