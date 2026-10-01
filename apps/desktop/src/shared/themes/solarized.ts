import type { Theme } from "./index";

/*
 * Solarized's light and dark themes, from its palette and the roles it gives
 * the monotones (https://ethanschoonover.com/solarized/, and the README of
 * https://github.com/altercation/solarized as of 62f656a). Where it names no
 * role, a token takes the colour of the highlight group named in its comment,
 * from Solarized's Vim theme (`vim-colors-solarized/colors/solarized.vim`),
 * or else of the face its Emacs theme gives
 * (`emacs-colors-solarized/color-theme-solarized.el`), both in the same
 * repository. Where a token departs from them, its comment says why.
 *
 * The palette and its Vim and Emacs themes come with this notice:
 *
 * Copyright (c) 2011 Ethan Schoonover
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

type Palette = Record<
  | "base03"
  | "base02"
  | "base01"
  | "base00"
  | "base0"
  | "base1"
  | "base2"
  | "base3"
  | "yellow"
  | "orange"
  | "red"
  | "magenta"
  | "violet"
  | "blue"
  | "cyan"
  | "green",
  string
>;

/**
 * Solarized as a theme, from the palette as the dark theme has it: the light
 * one swaps the monotones first, as the Vim and Emacs themes do, so that
 * base03 is always the background. Blue, the colour of Solarized's prompts
 * and links, marks the selection and focus. The sidebar is the background.
 */
function solarized(
  theme: Pick<Theme, "id" | "name" | "kind">,
  c: Palette,
  /** Each role whose colour is too faint on the background otherwise. */
  {
    text = c.base0, // Body text
    // Comments and secondary content are base01, 2.79:1 on Solarized Dark's
    // background, short of the 3:1 muted text needs. This is the next shade,
    // base00, which the Vim theme's high-contrast option gives comments
    // (3.37:1).
    subtle = c.base00,
    open = c.green,
    attention = c.yellow,
  }: Partial<Record<"text" | "subtle" | "open" | "attention", string>> = {},
): Theme {
  return {
    ...theme,
    colors: {
      background: c.base03, // Background
      foreground: text,
      card: c.base03,
      "card-foreground": text,
      // The background. On Emacs's menu, base02, a dialog's muted text would be
      // 2.92:1 in Solarized Dark.
      popover: c.base03,
      "popover-foreground": text,
      primary: c.blue, // Directory, ModeMsg; minibuffer-prompt
      // The background, as Vim's reversed groups show it on their colour.
      "primary-foreground": c.base03,
      secondary: c.base02, // custom-button
      // Base02 and base1, the palette's pair for highlighted text.
      "secondary-foreground": c.base1,
      muted: c.base02, // Background highlights: CursorLine; highlight, region
      "muted-foreground": subtle,
      accent: c.base02, // highlight
      "accent-foreground": c.base1,
      destructive: c.red, // Error, ErrorMsg
      border: c.base02, // ColorColumn, the Vim theme's guide line
      // Secondary content. On base02, an outline button's edge would be 1.15:1
      // on the background.
      input: c.base01,
      ring: c.blue,
      // Not base02, the gutter's colour in the Vim and Emacs themes: text is
      // 4.11:1 on it in Solarized Dark.
      sidebar: c.base03,
      "sidebar-foreground": text,
      "sidebar-primary": c.blue,
      "sidebar-primary-foreground": c.base03,
      "sidebar-accent": c.base02, // As muted: a selected entry without focus
      "sidebar-accent-foreground": c.base1,
      "sidebar-border": c.base02,
      "sidebar-ring": c.blue,
      // Solarized names no backdrop, and has no colour darker than its dark
      // background.
      overlay: "#00000066",
      "issue-open": open, // DiffAdd; org-done
      "issue-closed": c.violet, // Purple, as GitHub has closed issues
      blocked: c.red, // Error
      // At 10%, as GitHub Dark's is: Solarized gives errors no background.
      "blocked-surface": `${c.red}1a`,
      blocking: attention, // DiffChange, Search
      warning: attention,
      // The accent at 20%: base02, the Emacs theme's region, is a selected row
      // without focus here.
      selection: `${c.blue}33`,
      "selection-edge": c.blue,
      "map-new": `${open}66`,
      "map-moved": `${attention}66`,
      "gh-fg-muted": subtle,
      // Links: helpHyperTextJump, pandocLinkText; info-xref. Not Underlined's
      // violet, which closed issues have.
      "gh-accent": c.blue,
      "gh-border": c.base02,
      "gh-border-muted": c.base02,
      "gh-canvas-subtle": c.base02, // Background highlights
      "gh-neutral-muted": c.base02,
      "gh-success": open,
      "gh-done": c.violet,
      "gh-attention": attention,
      "gh-danger": c.red,
      // Code, as the Vim theme's syntax groups colour it.
      "pl-comment": c.base01, // Comment
      // Not Constant's cyan, which strings have too: GitHub gives this class to
      // calls, properties and operators as well as to literals, so it takes the
      // blue of Identifier, the group of variable and function names.
      "pl-constant": c.blue,
      "pl-reference-link": c.blue, // pandocLinkText
      "pl-entity": c.blue, // Function
      // GitHub gives this class to type and class names.
      "pl-storage-modifier-import": c.yellow, // Type
      "pl-entity-tag": c.blue, // htmlTagName
      "pl-keyword": c.green, // Statement
      "pl-string": c.cyan, // String, a Constant
      // GitHub gives this class to the classes a line refers to, such as a
      // superclass or a JSX component.
      "pl-variable": c.yellow, // Type
      "pl-bracket-unmatched": c.red, // Error
      "pl-bracket-angle": c.base01, // htmlTag, htmlEndTag
      "pl-invalid-text": c.red, // Error
      "pl-invalid-bg": `${c.red}1a`,
      // As ErrorMsg, reversed: the background on red.
      "pl-carriage-return-text": c.base03,
      "pl-carriage-return-bg": c.red,
      "pl-string-regexp": c.red, // Special
      "pl-markup-list": c.magenta, // pandocListMarker
      "pl-markup-heading": c.orange, // Title, pandocHeading
      "pl-markup-italic": text,
      "pl-markup-bold": c.base1, // Optional emphasized content
      // As the Vim theme's default diff mode has them: the text in its colour on
      // base02, the code block's own background.
      "pl-markup-deleted-text": c.red, // DiffDelete
      "pl-markup-deleted-bg": c.base02,
      "pl-markup-inserted-text": c.green, // DiffAdd
      "pl-markup-inserted-bg": c.base02,
      "pl-markup-changed-text": c.yellow, // DiffChange
      "pl-markup-changed-bg": c.base02,
      // Reversed, as GitHub shows ignored lines: the background on base01, the
      // colour of gitcommitUntracked.
      "pl-markup-ignored-text": c.base03,
      "pl-markup-ignored-bg": c.base01,
      "pl-meta-diff-range": c.blue, // diffLine
      "pl-gutter-mark": c.base01, // LineNr
    },
  };
}

/** Solarized's sixteen colours, as the palette names them. */
const palette: Palette = {
  // The monotones, from darkest to lightest.
  base03: "#002b36",
  base02: "#073642",
  base01: "#586e75",
  base00: "#657b83",
  base0: "#839496",
  base1: "#93a1a1",
  base2: "#eee8d5",
  base3: "#fdf6e3",
  // The accents.
  yellow: "#b58900",
  orange: "#cb4b16",
  red: "#dc322f",
  magenta: "#d33682",
  violet: "#6c71c4",
  blue: "#268bd2",
  cyan: "#2aa198",
  green: "#859900",
};

export const solarizedLight = solarized(
  { id: "solarized-light", name: "Solarized Light", kind: "light" },
  {
    ...palette,
    base03: palette.base3,
    base02: palette.base2,
    base01: palette.base1,
    base00: palette.base0,
    base0: palette.base00,
    base1: palette.base01,
    base2: palette.base02,
    base3: palette.base03,
  },
  // In the palette's own names, as they are before the swap.
  {
    // Body text, base00, is 4.13:1 on base3, short of the 4.5:1 text needs.
    // This is base01, the emphasized content, which the Vim theme's
    // high-contrast option makes body text (4.99:1).
    text: palette.base01,
    // The comments' base1 and the next shade, base0, are 2.48:1 and 2.93:1 on
    // base3, short of the 3:1 muted text needs. This is the xterm colour the
    // palette gives base1, which the Vim theme shows with 256 colours
    // (3.20:1): base00, the shade after, passes too, but is barely lighter than
    // the text.
    subtle: "#8a8a8a",
    // Green and yellow are 2.97:1 and 2.98:1 on base3, short of the 3:1 open
    // and "blocks" need. These are the xterm colours the palette gives them too,
    // which the Vim theme shows with 256 colours (3.93:1 and 3.10:1).
    open: "#5f8700",
    attention: "#af8700",
  },
);

export const solarizedDark = solarized(
  { id: "solarized-dark", name: "Solarized Dark", kind: "dark" },
  palette,
);
