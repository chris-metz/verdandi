import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";
import {
  builtInThemes,
  defaultDarkTheme,
  defaultLightTheme,
  shownTheme,
  themeCatalogue,
  themeTokens,
  type ThemeToken,
} from "./index";

describe("built-in themes", () => {
  it("are GitHub's, Catppuccin's, Tokyo Night's, Nord's, Rosé Pine's and Solarized's", () => {
    expect(
      builtInThemes.map(({ id, name, kind }) => ({ id, name, kind })),
    ).toEqual([
      { id: "github-light", name: "GitHub Light", kind: "light" },
      { id: "github-dark", name: "GitHub Dark", kind: "dark" },
      { id: "github-dark-dimmed", name: "GitHub Dark Dimmed", kind: "dark" },
      { id: "catppuccin-latte", name: "Catppuccin Latte", kind: "light" },
      { id: "catppuccin-frappe", name: "Catppuccin Frappé", kind: "dark" },
      {
        id: "catppuccin-macchiato",
        name: "Catppuccin Macchiato",
        kind: "dark",
      },
      { id: "catppuccin-mocha", name: "Catppuccin Mocha", kind: "dark" },
      { id: "tokyo-night-day", name: "Tokyo Night Day", kind: "light" },
      { id: "tokyo-night-storm", name: "Tokyo Night Storm", kind: "dark" },
      { id: "tokyo-night", name: "Tokyo Night", kind: "dark" },
      { id: "nord", name: "Nord", kind: "dark" },
      { id: "rose-pine-dawn", name: "Rosé Pine Dawn", kind: "light" },
      { id: "rose-pine-moon", name: "Rosé Pine Moon", kind: "dark" },
      { id: "solarized-light", name: "Solarized Light", kind: "light" },
      { id: "solarized-dark", name: "Solarized Dark", kind: "dark" },
    ]);
  });

  it("have unique IDs", () => {
    const ids = builtInThemes.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("default to GitHub Light and GitHub Dark", () => {
    expect(defaultLightTheme.id).toBe("github-light");
    expect(defaultDarkTheme.id).toBe("github-dark");
  });

  it("show the default light or dark theme when none is chosen", () => {
    expect(shownTheme(false).id).toBe("github-light");
    expect(shownTheme(true).id).toBe("github-dark");
  });

  it("show the chosen light or dark theme", () => {
    const chosen = {
      lightTheme: "github-light",
      darkTheme: "github-dark-dimmed",
    };
    expect(shownTheme(false, chosen).id).toBe("github-light");
    expect(shownTheme(true, chosen).id).toBe("github-dark-dimmed");
  });

  it("show the default for a chosen theme they do not have, or of the other kind", () => {
    expect(
      shownTheme(true, {
        lightTheme: "github-light",
        darkTheme: "no-such-theme",
      }).id,
    ).toBe("github-dark");
    expect(
      shownTheme(false, { lightTheme: "github-dark", darkTheme: "github-dark" })
        .id,
    ).toBe("github-light");
  });

  it("are offered to the core by ID and kind, with the defaults", () => {
    expect(themeCatalogue).toEqual({
      themes: builtInThemes,
      defaults: { light: "github-light", dark: "github-dark" },
    });
  });

  describe.each(builtInThemes)("$name", (theme) => {
    const colour = (token: ThemeToken) => theme.colors[token];

    it("defines every token as a hex colour, and nothing else", () => {
      expect(Object.keys(theme.colors).sort()).toEqual([...themeTokens].sort());
      for (const token of themeTokens)
        expect(colour(token), token).toMatch(/^#([0-9a-f]{6}|[0-9a-f]{8})$/);
    });

    it.each(["background", "sidebar", "card"] as const)(
      "shows foreground on %s at 4.5:1 or more",
      (surface) => {
        expect(
          contrastRatio(colour("foreground"), colour(surface)),
        ).toBeGreaterThanOrEqual(4.5);
      },
    );

    it.each([
      "muted-foreground",
      "issue-open",
      "issue-closed",
      "blocked",
      "blocking",
    ] as const)("shows %s on background at 3:1 or more", (token) => {
      expect(
        contrastRatio(colour(token), colour("background")),
      ).toBeGreaterThanOrEqual(3);
    });
  });
});
