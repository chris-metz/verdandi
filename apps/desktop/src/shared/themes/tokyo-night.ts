import type { Theme } from "./index";

/*
 * Tokyo Night's Day, Storm and Night styles, from tokyonight.nvim
 * (https://github.com/folke/tokyonight.nvim, v4.14.1): each style's palette
 * in `lua/tokyonight/colors/`, with the colours it derives for UI roles, as
 * the generated `extras/lua/tokyonight_<style>.lua` resolves them. Each token
 * takes the colour of the highlight group named in its comment, from
 * `lua/tokyonight/groups/`; where a token departs from them, its comment
 * says why.
 *
 * tokyonight.nvim is licensed under the Apache License, Version 2.0
 * (http://www.apache.org/licenses/LICENSE-2.0), which names no copyright
 * holder for it. It is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
 * CONDITIONS OF ANY KIND, either express or implied.
 */

type Palette = Record<
  // The palette.
  | "bg"
  | "bg_dark"
  | "bg_dark1"
  | "bg_highlight"
  | "blue"
  | "blue0"
  | "blue1"
  | "blue2"
  | "blue5"
  | "blue6"
  | "blue7"
  | "comment"
  | "cyan"
  | "dark3"
  | "dark5"
  | "fg"
  | "fg_dark"
  | "fg_gutter"
  | "green"
  | "green1"
  | "green2"
  | "magenta"
  | "magenta2"
  | "orange"
  | "purple"
  | "red"
  | "red1"
  | "teal"
  | "terminal_black"
  | "yellow"
  // What Tokyo Night derives from it for UI roles.
  | "black"
  | "border"
  | "bg_sidebar"
  | "fg_sidebar"
  | "bg_float"
  | "fg_float"
  | "error"
  | "warning",
  string
> & {
  // The palette's git colours, and the diff backgrounds derived from it.
  git: Record<"add" | "change" | "delete", string>;
  diff: Record<"add" | "change" | "delete", string>;
};

/**
 * A style as a theme. Blue, Tokyo Night's accent, marks the selection and
 * focus, as it does its titles and selected tab.
 */
function tokyoNightTheme(
  theme: Pick<Theme, "id" | "name" | "kind">,
  c: Palette,
  /** Inline code's background: terminal_black, unless text is too faint on it. */
  inlineCode = c.terminal_black,
): Theme {
  return {
    ...theme,
    colors: {
      background: c.bg, // Normal
      foreground: c.fg,
      card: c.bg,
      "card-foreground": c.fg,
      popover: c.bg_float, // NormalFloat
      "popover-foreground": c.fg_float,
      primary: c.blue, // TabLineSel
      // The background on a colour, as the cursor and Todo have it: TabLineSel's
      // black is too light on Day's blue.
      "primary-foreground": c.bg,
      secondary: c.bg_highlight,
      "secondary-foreground": c.fg,
      muted: c.bg_highlight, // CursorLine
      // Conceal. Comment and dark3, Tokyo Night's fainter greys, are under 3:1.
      "muted-foreground": c.dark5,
      accent: `${c.fg_gutter}cc`, // PmenuSel, fg_gutter at 80%
      "accent-foreground": c.fg,
      destructive: c.error, // ErrorMsg
      // LineNr's colour: on Storm and Night, WinSeparator's, border, is darker
      // than the background and would all but hide a card's edge.
      border: c.fg_gutter,
      input: c.fg_gutter,
      ring: c.blue,
      sidebar: c.bg_sidebar, // NormalSB
      "sidebar-foreground": c.fg_sidebar,
      "sidebar-primary": c.blue,
      "sidebar-primary-foreground": c.bg,
      "sidebar-accent": `${c.fg_gutter}cc`,
      "sidebar-accent-foreground": c.fg,
      "sidebar-border": c.border, // WinSeparator
      "sidebar-ring": c.blue,
      overlay: `${c.black}99`,
      "issue-open": c.green,
      "issue-closed": c.magenta, // OctoStateMerged
      blocked: c.red,
      // At 10%, as the DiagnosticVirtualText groups blend their colours.
      "blocked-surface": `${c.red}1a`,
      blocking: c.warning, // WarningMsg
      warning: c.warning,
      // The accent at 20%: Visual's bg_visual is for selected text.
      selection: `${c.blue}33`,
      "selection-edge": c.blue,
      "map-new": `${c.green}66`,
      "map-moved": `${c.warning}66`,
      "gh-fg-muted": c.dark5,
      "gh-accent": c.blue1, // @markup.link.label, through SpecialChar
      "gh-border": c.fg_gutter,
      "gh-border-muted": c.bg_highlight,
      "gh-canvas-subtle": c.bg_dark, // RenderMarkdownCode
      "gh-neutral-muted": inlineCode, // @markup.raw.markdown_inline
      "gh-success": c.green,
      "gh-done": c.magenta,
      "gh-attention": c.warning,
      "gh-danger": c.error, // DiagnosticError
      // Code, as Tokyo Night's Treesitter groups colour it.
      "pl-comment": c.comment, // Comment
      // Not Constant's orange: GitHub gives this class to operators,
      // properties and calls as well as to literals, so it takes @operator's
      // colour.
      "pl-constant": c.blue5,
      "pl-reference-link": c.teal, // @markup.link
      "pl-entity": c.blue, // Function
      // GitHub gives this class to type and class names.
      "pl-storage-modifier-import": c.blue1, // Type
      "pl-entity-tag": c.red, // @tag.javascript
      // Statement, which if, for and the like take, as do @keyword.function and
      // VS Code's Keyword.
      "pl-keyword": c.magenta,
      "pl-string": c.green, // String
      // GitHub gives this class to the classes a line refers to, such as a
      // superclass or a JSX component.
      "pl-variable": c.blue1, // Type, @constructor.tsx
      "pl-bracket-unmatched": c.error, // Error
      "pl-bracket-angle": c.fg_dark, // @punctuation.bracket
      "pl-invalid-text": c.error,
      "pl-invalid-bg": `${c.error}1a`,
      "pl-carriage-return-text": c.bg,
      "pl-carriage-return-bg": c.error,
      "pl-string-regexp": c.magenta, // @string.escape
      "pl-markup-list": c.orange, // @markup.list.markdown
      "pl-markup-heading": c.blue, // Title
      "pl-markup-italic": c.fg,
      "pl-markup-bold": c.fg,
      // The text keeps its colour, as @diff.minus, @diff.plus and @diff.delta
      // leave it: diffRemoved's git colour is about 2:1 on its background.
      "pl-markup-deleted-text": c.fg,
      "pl-markup-deleted-bg": c.diff.delete, // DiffDelete
      "pl-markup-inserted-text": c.fg,
      "pl-markup-inserted-bg": c.diff.add, // DiffAdd
      "pl-markup-changed-text": c.fg,
      "pl-markup-changed-bg": c.diff.change, // DiffChange
      "pl-markup-ignored-text": c.bg,
      "pl-markup-ignored-bg": c.blue,
      "pl-meta-diff-range": c.comment, // diffLine
      "pl-gutter-mark": c.fg_gutter, // LineNr
    },
  };
}

const storm: Palette = {
  bg: "#24283b",
  bg_dark: "#1f2335",
  bg_dark1: "#1b1e2d",
  bg_highlight: "#292e42",
  blue: "#7aa2f7",
  blue0: "#3d59a1",
  blue1: "#2ac3de",
  blue2: "#0db9d7",
  blue5: "#89ddff",
  blue6: "#b4f9f8",
  blue7: "#394b70",
  comment: "#565f89",
  cyan: "#7dcfff",
  dark3: "#545c7e",
  dark5: "#737aa2",
  fg: "#c0caf5",
  fg_dark: "#a9b1d6",
  fg_gutter: "#3b4261",
  green: "#9ece6a",
  green1: "#73daca",
  green2: "#41a6b5",
  magenta: "#bb9af7",
  magenta2: "#ff007c",
  orange: "#ff9e64",
  purple: "#9d7cd8",
  red: "#f7768e",
  red1: "#db4b4b",
  teal: "#1abc9c",
  terminal_black: "#414868",
  yellow: "#e0af68",
  black: "#1d202f",
  border: "#1d202f",
  bg_sidebar: "#1f2335",
  fg_sidebar: "#a9b1d6",
  bg_float: "#1f2335",
  fg_float: "#c0caf5",
  error: "#db4b4b",
  warning: "#e0af68",
  git: { add: "#449dab", change: "#6183bb", delete: "#914c54" },
  diff: { add: "#2b485a", change: "#272d43", delete: "#52313f" },
};

const night: Palette = {
  ...storm,
  bg: "#1a1b26",
  bg_dark: "#16161e",
  bg_dark1: "#0c0e14",
  black: "#15161e",
  border: "#15161e",
  bg_sidebar: "#16161e",
  bg_float: "#16161e",
  diff: { add: "#243e4a", change: "#1f2231", delete: "#4a272f" },
};

const day: Palette = {
  bg: "#e1e2e7",
  bg_dark: "#d0d5e3",
  bg_dark1: "#c1c9df",
  bg_highlight: "#c4c8da",
  blue: "#2e7de9",
  blue0: "#7890dd",
  blue1: "#188092",
  blue2: "#07879d",
  blue5: "#006a83",
  blue6: "#2e5857",
  blue7: "#92a6d5",
  comment: "#848cb5",
  cyan: "#007197",
  dark3: "#8990b3",
  dark5: "#68709a",
  fg: "#3760bf",
  fg_dark: "#6172b0",
  fg_gutter: "#a8aecb",
  green: "#587539",
  green1: "#387068",
  green2: "#38919f",
  magenta: "#9854f1",
  magenta2: "#d20065",
  orange: "#b15c00",
  purple: "#7847bd",
  red: "#f52a65",
  red1: "#c64343",
  teal: "#118c74",
  terminal_black: "#a1a6c5",
  yellow: "#8c6c3e",
  black: "#b4b5b9",
  border: "#b4b5b9",
  bg_sidebar: "#d0d5e3",
  fg_sidebar: "#6172b0",
  bg_float: "#d0d5e3",
  fg_float: "#3760bf",
  error: "#c64343",
  warning: "#8c6c3e",
  git: { add: "#4197a4", change: "#506d9c", delete: "#c47981" },
  diff: { add: "#b7ced5", change: "#d5d9e4", delete: "#dababe" },
};

export const tokyoNightDay = tokyoNightTheme(
  { id: "tokyo-night-day", name: "Tokyo Night Day", kind: "light" },
  // Day's foreground is 3.99:1 on its dark sidebars and floats, bg_dark, short
  // of the 4.5:1 text needs. So they take Tokyo Night's "normal" style instead
  // of "dark", the background (4.52:1). The sidebar's own text, fg_dark, is
  // 3.57:1 even there, so the sidebar shows the foreground too.
  { ...day, bg_sidebar: day.bg, fg_sidebar: day.fg, bg_float: day.bg },
  // Its terminal_black leaves the foreground at 2.45:1. This is the background
  // RenderMarkdownCode gives its code blocks, bg_dark (3.99:1).
  day.bg_dark,
);

export const tokyoNightStorm = tokyoNightTheme(
  { id: "tokyo-night-storm", name: "Tokyo Night Storm", kind: "dark" },
  storm,
);

export const tokyoNight = tokyoNightTheme(
  { id: "tokyo-night", name: "Tokyo Night", kind: "dark" },
  night,
);
