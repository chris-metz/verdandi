import type { Config } from "@verdandi/core/contract";
import {
  catppuccinFrappe,
  catppuccinLatte,
  catppuccinMacchiato,
  catppuccinMocha,
} from "./catppuccin";
import { githubDark, githubDarkDimmed, githubLight } from "./github";
import { tokyoNight, tokyoNightDay, tokyoNightStorm } from "./tokyo-night";

/**
 * Every colour a theme gives, each shown on the page as a CSS custom property
 * of the same name, e.g. `--background`.
 */
export const themeTokens = [
  // The surface, as shadcn's components name it.
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  // Behind a dialog, over the rest of the window.
  "overlay",
  // Verdandi's meanings.
  "issue-open",
  "issue-closed",
  // "Blocked by", in red.
  "blocked",
  "blocked-surface",
  // "Blocks", in amber.
  "blocking",
  // What could not be read, or is shown from before.
  "warning",
  // The selected row of the focused list.
  "selection",
  "selection-edge",
  // The blocking map's flashes: a card that is new, and one that moved.
  "map-new",
  "map-moved",
  // Issue bodies and comments, as github.com shows them.
  "gh-fg-muted",
  "gh-accent",
  "gh-border",
  "gh-border-muted",
  "gh-canvas-subtle",
  "gh-neutral-muted",
  "gh-success",
  "gh-done",
  "gh-attention",
  "gh-danger",
  // Their highlighted code, in GitHub's "prettylights" colours.
  "pl-comment",
  "pl-constant",
  "pl-reference-link",
  "pl-entity",
  "pl-storage-modifier-import",
  "pl-entity-tag",
  "pl-keyword",
  "pl-string",
  "pl-variable",
  "pl-bracket-unmatched",
  "pl-bracket-angle",
  "pl-invalid-text",
  "pl-invalid-bg",
  "pl-carriage-return-text",
  "pl-carriage-return-bg",
  "pl-string-regexp",
  "pl-markup-list",
  "pl-markup-heading",
  "pl-markup-italic",
  "pl-markup-bold",
  "pl-markup-deleted-text",
  "pl-markup-deleted-bg",
  "pl-markup-inserted-text",
  "pl-markup-inserted-bg",
  "pl-markup-changed-text",
  "pl-markup-changed-bg",
  "pl-markup-ignored-text",
  "pl-markup-ignored-bg",
  "pl-meta-diff-range",
  "pl-gutter-mark",
] as const;

export type ThemeToken = (typeof themeTokens)[number];

/** A named set of colours for Verdandi, either light or dark. */
export interface Theme {
  id: string;
  name: string;
  kind: "light" | "dark";
  /** Each token's colour, as `#rrggbb` or `#rrggbbaa`. */
  colors: Record<ThemeToken, string>;
}

/** Every theme that comes with Verdandi. */
export const builtInThemes: readonly Theme[] = [
  githubLight,
  githubDark,
  githubDarkDimmed,
  catppuccinLatte,
  catppuccinFrappe,
  catppuccinMacchiato,
  catppuccinMocha,
  tokyoNightDay,
  tokyoNightStorm,
  tokyoNight,
];

export const defaultLightTheme = githubLight;
export const defaultDarkTheme = githubDark;

/**
 * The themes as the core checks `config.toml` against them: by ID, each
 * light or dark, with the defaults.
 */
export const themeCatalogue = {
  themes: builtInThemes,
  defaults: { light: defaultLightTheme.id, dark: defaultDarkTheme.id },
};

/**
 * The theme Verdandi shows, light or dark as the appearance says: the chosen
 * one of that kind, or the default when none is chosen or it cannot be used.
 */
export function shownTheme(
  dark: boolean,
  chosen?: Pick<Config, "lightTheme" | "darkTheme">,
): Theme {
  const kind = dark ? "dark" : "light";
  const id = dark ? chosen?.darkTheme : chosen?.lightTheme;
  return (
    builtInThemes.find((theme) => theme.id === id && theme.kind === kind) ??
    (dark ? defaultDarkTheme : defaultLightTheme)
  );
}
