import type { Theme } from "./index";

/*
 * Catppuccin's four flavours, from its palette
 * (https://github.com/catppuccin/palette, palette.json 1.8.0). Each token
 * takes the colour Catppuccin's style guide names for its role
 * (https://github.com/catppuccin/catppuccin/blob/main/docs/style-guide.md);
 * where it names none, the one Catppuccin's VS Code theme or its GitHub
 * userstyle gives the same role. Where a token departs from the guide, its
 * comment says why.
 *
 * The palette comes with this notice:
 *
 * MIT License
 *
 * Copyright (c) 2021 Catppuccin
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

type Palette = Record<
  | "rosewater"
  | "flamingo"
  | "pink"
  | "mauve"
  | "red"
  | "maroon"
  | "peach"
  | "yellow"
  | "green"
  | "teal"
  | "sky"
  | "sapphire"
  | "blue"
  | "lavender"
  | "text"
  | "subtext1"
  | "subtext0"
  | "overlay2"
  | "overlay1"
  | "overlay0"
  | "surface2"
  | "surface1"
  | "surface0"
  | "base"
  | "mantle"
  | "crust",
  string
>;

/**
 * A flavour as a theme. Mauve, Catppuccin's default accent, marks the
 * selection and focus, as it does in its editor themes; closed issues take
 * it too, as GitHub's "done" does in Catppuccin's userstyle.
 */
function catppuccin(
  theme: Pick<Theme, "id" | "name" | "kind">,
  c: Palette,
  /** "Blocks" and warnings: yellow, unless that is too light. */
  attention = c.yellow,
): Theme {
  return {
    ...theme,
    colors: {
      background: c.base, // Background Pane
      foreground: c.text, // Body Copy
      card: c.base,
      "card-foreground": c.text,
      popover: c.base,
      "popover-foreground": c.text,
      primary: c.mauve,
      "primary-foreground": c.base, // On Accent
      secondary: c.surface0, // Surface Elements
      "secondary-foreground": c.text,
      muted: c.surface0,
      "muted-foreground": c.subtext0, // Sub-Headlines, Labels
      accent: `${c.surface2}33`,
      "accent-foreground": c.text,
      destructive: c.red, // Errors
      border: c.surface1,
      input: c.surface1,
      ring: c.mauve,
      sidebar: c.mantle, // Secondary Panes
      "sidebar-foreground": c.text,
      "sidebar-primary": c.mauve,
      "sidebar-primary-foreground": c.base,
      "sidebar-accent": `${c.surface2}33`,
      "sidebar-accent-foreground": c.text,
      "sidebar-border": c.surface0,
      "sidebar-ring": c.mauve,
      overlay: `${c.crust}99`,
      "issue-open": c.green, // Success
      "issue-closed": c.mauve,
      blocked: c.red,
      "blocked-surface": `${c.red}26`,
      blocking: attention, // Warnings
      warning: attention,
      // The accent: the guide's Selection Background, Overlay 2, is for
      // selected text.
      selection: `${c.mauve}33`,
      "selection-edge": c.mauve,
      "map-new": `${c.green}66`,
      "map-moved": `${attention}66`,
      "gh-fg-muted": c.subtext0,
      "gh-accent": c.blue, // Links, URLs
      "gh-border": c.surface1,
      "gh-border-muted": c.surface0,
      "gh-canvas-subtle": c.mantle,
      "gh-neutral-muted": `${c.surface0}66`,
      "gh-success": c.green,
      "gh-done": c.mauve,
      "gh-attention": attention,
      "gh-danger": c.red,
      // Code, as the style guide's Code Editors section colours it.
      "pl-comment": c.overlay2, // Comments
      // Not the guide's peach for Constants, Numbers: GitHub gives this class
      // to calls and properties as well, which it makes blue (Methods,
      // Functions; Property), as Catppuccin's userstyle does.
      "pl-constant": c.blue,
      "pl-reference-link": c.blue, // Links
      "pl-entity": c.blue, // Methods, Functions
      // GitHub gives this class to type and class names.
      "pl-storage-modifier-import": c.yellow, // Classes, Types
      "pl-entity-tag": c.blue,
      "pl-keyword": c.mauve, // Keyword
      "pl-string": c.green, // Strings
      "pl-variable": c.yellow, // Classes, Types
      "pl-bracket-unmatched": c.red, // Errors
      "pl-bracket-angle": c.overlay2, // Braces, Delimiters
      "pl-invalid-text": c.red,
      "pl-invalid-bg": `${c.red}26`,
      "pl-carriage-return-text": c.base,
      "pl-carriage-return-bg": c.red,
      "pl-string-regexp": c.pink, // Escape Sequences, Regex
      "pl-markup-list": c.teal,
      "pl-markup-heading": c.red,
      "pl-markup-italic": c.red,
      "pl-markup-bold": c.red,
      "pl-markup-deleted-text": c.red,
      "pl-markup-deleted-bg": `${c.red}26`, // Removed Text BG
      "pl-markup-inserted-text": c.green,
      "pl-markup-inserted-bg": `${c.green}26`, // Inserted Text BG
      "pl-markup-changed-text": c.blue,
      "pl-markup-changed-bg": `${c.blue}26`, // Changed Text BG
      "pl-markup-ignored-text": c.base,
      "pl-markup-ignored-bg": c.blue,
      "pl-meta-diff-range": c.peach, // Hunk Header
      "pl-gutter-mark": c.overlay1, // Line Numbers
    },
  };
}

const latte: Palette = {
  rosewater: "#dc8a78",
  flamingo: "#dd7878",
  pink: "#ea76cb",
  mauve: "#8839ef",
  red: "#d20f39",
  maroon: "#e64553",
  peach: "#fe640b",
  yellow: "#df8e1d",
  green: "#40a02b",
  teal: "#179299",
  sky: "#04a5e5",
  sapphire: "#209fb5",
  blue: "#1e66f5",
  lavender: "#7287fd",
  text: "#4c4f69",
  subtext1: "#5c5f77",
  subtext0: "#6c6f85",
  overlay2: "#7c7f93",
  overlay1: "#8c8fa1",
  overlay0: "#9ca0b0",
  surface2: "#acb0be",
  surface1: "#bcc0cc",
  surface0: "#ccd0da",
  base: "#eff1f5",
  mantle: "#e6e9ef",
  crust: "#dce0e8",
};

const frappe: Palette = {
  rosewater: "#f2d5cf",
  flamingo: "#eebebe",
  pink: "#f4b8e4",
  mauve: "#ca9ee6",
  red: "#e78284",
  maroon: "#ea999c",
  peach: "#ef9f76",
  yellow: "#e5c890",
  green: "#a6d189",
  teal: "#81c8be",
  sky: "#99d1db",
  sapphire: "#85c1dc",
  blue: "#8caaee",
  lavender: "#babbf1",
  text: "#c6d0f5",
  subtext1: "#b5bfe2",
  subtext0: "#a5adce",
  overlay2: "#949cbb",
  overlay1: "#838ba7",
  overlay0: "#737994",
  surface2: "#626880",
  surface1: "#51576d",
  surface0: "#414559",
  base: "#303446",
  mantle: "#292c3c",
  crust: "#232634",
};

const macchiato: Palette = {
  rosewater: "#f4dbd6",
  flamingo: "#f0c6c6",
  pink: "#f5bde6",
  mauve: "#c6a0f6",
  red: "#ed8796",
  maroon: "#ee99a0",
  peach: "#f5a97f",
  yellow: "#eed49f",
  green: "#a6da95",
  teal: "#8bd5ca",
  sky: "#91d7e3",
  sapphire: "#7dc4e4",
  blue: "#8aadf4",
  lavender: "#b7bdf8",
  text: "#cad3f5",
  subtext1: "#b8c0e0",
  subtext0: "#a5adcb",
  overlay2: "#939ab7",
  overlay1: "#8087a2",
  overlay0: "#6e738d",
  surface2: "#5b6078",
  surface1: "#494d64",
  surface0: "#363a4f",
  base: "#24273a",
  mantle: "#1e2030",
  crust: "#181926",
};

const mocha: Palette = {
  rosewater: "#f5e0dc",
  flamingo: "#f2cdcd",
  pink: "#f5c2e7",
  mauve: "#cba6f7",
  red: "#f38ba8",
  maroon: "#eba0ac",
  peach: "#fab387",
  yellow: "#f9e2af",
  green: "#a6e3a1",
  teal: "#94e2d5",
  sky: "#89dceb",
  sapphire: "#74c7ec",
  blue: "#89b4fa",
  lavender: "#b4befe",
  text: "#cdd6f4",
  subtext1: "#bac2de",
  subtext0: "#a6adc8",
  overlay2: "#9399b2",
  overlay1: "#7f849c",
  overlay0: "#6c7086",
  surface2: "#585b70",
  surface1: "#45475a",
  surface0: "#313244",
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
};

export const catppuccinLatte = catppuccin(
  { id: "catppuccin-latte", name: "Catppuccin Latte", kind: "light" },
  // Latte's green, #40a02b, is 2.96:1 on its base, just short of the 3:1 an
  // open issue needs, and Catppuccin has no darker shade of it. This is the
  // same hue, darkened in OKLCH only as far as 3:1.
  { ...latte, green: "#3e9e29" },
  // Its yellow (2.31:1) and peach (2.64:1) are too light as well. This is its
  // peach, #fe640b, darkened only as far as 3:1.
  "#f25800",
);

export const catppuccinFrappe = catppuccin(
  { id: "catppuccin-frappe", name: "Catppuccin Frappé", kind: "dark" },
  frappe,
);

export const catppuccinMacchiato = catppuccin(
  { id: "catppuccin-macchiato", name: "Catppuccin Macchiato", kind: "dark" },
  macchiato,
);

export const catppuccinMocha = catppuccin(
  { id: "catppuccin-mocha", name: "Catppuccin Mocha", kind: "dark" },
  mocha,
);
