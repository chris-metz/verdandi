import type { Theme } from "./index";

/*
 * Rosé Pine's Dawn and Moon variants, from its palette as its website lists it
 * (https://rosepinetheme.com/palette/ingredients/): the one in
 * https://github.com/rose-pine/palette (v4.0.1, `source/index.ts`) but for
 * Dawn's text. Each token takes the colour the palette's README names for its
 * role; where it names none, the colour of the key or scope named in its
 * comment, from Rosé Pine's VS Code theme (https://github.com/rose-pine/vscode,
 * v2.15.2, `themes/_pinecone-color-theme.json`), or else the one Rosé Pine's
 * GitHub userstyle (https://github.com/rose-pine/userstyles, 5a38401,
 * `styles/github/rose-pine.user.less`) gives the same GitHub colour. A shade
 * the palette lacks comes from Bloom, Rosé Pine's theme builder
 * (https://github.com/rose-pine/rose-pine-bloom, e728487, `color/shade.go`).
 * Where a token departs from them, its comment says why. The main variant is
 * left out.
 *
 * The palette, the VS Code theme and Bloom each come with this notice. The
 * first copyright line is the palette's, the second the VS Code theme's, the
 * third Bloom's:
 *
 * MIT License
 *
 * Copyright (c) mvllow
 * Copyright (c) 2021 Rosé Pine
 * Copyright (c) 2025 Rosé Pine
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
  | "base"
  | "surface"
  | "overlay"
  | "muted"
  | "subtle"
  | "text"
  | "love"
  | "gold"
  | "rose"
  | "pine"
  | "foam"
  | "iris"
  | "highlightLow"
  | "highlightMed"
  | "highlightHigh",
  string
>;

/**
 * A variant as a theme. Rose, the VS Code theme's primary colour, marks the
 * selection and focus. The sidebar is the background, as the palette has it.
 */
function rosePine(
  theme: Pick<Theme, "id" | "name" | "kind">,
  c: Palette,
  /** "Blocks" and warnings: gold, unless that is too light. */
  attention = c.gold,
): Theme {
  return {
    ...theme,
    colors: {
      background: c.base, // Primary background
      foreground: c.text,
      card: c.base,
      "card-foreground": c.text,
      popover: c.surface, // menu.background, editorWidget.background
      "popover-foreground": c.text,
      primary: c.rose, // button.background
      "primary-foreground": c.base, // button.foreground
      secondary: c.surface, // button.secondaryBackground
      "secondary-foreground": c.text,
      // A selected row in a list without focus. The GitHub userstyle's
      // bgColor-muted, and the palette's active tabs: the VS Code theme's
      // list.inactiveSelectionBackground, surface, is 1.09:1 on Moon's base,
      // and lighter than Dawn's.
      muted: c.overlay,
      // descriptionForeground. Muted, the comments' colour, is 2.73:1 on Dawn's
      // base.
      "muted-foreground": c.subtle,
      accent: c.highlightMed, // menu.selectionBackground
      "accent-foreground": c.text,
      destructive: c.love, // Errors
      border: c.highlightHigh, // Borders
      input: c.highlightMed, // input.border
      // The accent, as the GitHub userstyle's focus-outlineColor is its own.
      // The VS Code theme's focusBorder, the palette's translucent
      // highlightMed, is 1.10:1 on Dawn's base.
      ring: c.rose,
      sidebar: c.base, // Sidebars
      // Not sideBar.foreground's subtle: on Dawn it is 4.02:1, short of the
      // 4.5:1 text needs.
      "sidebar-foreground": c.text,
      "sidebar-primary": c.rose,
      "sidebar-primary-foreground": c.base,
      "sidebar-accent": c.overlay, // As muted: a selected entry without focus
      "sidebar-accent-foreground": c.text,
      "sidebar-border": c.highlightMed, // sideBarSectionHeader.border
      "sidebar-ring": c.rose,
      // Rosé Pine names no backdrop: the GitHub userstyle gives every variant
      // this one.
      overlay: "#161b2266",
      "issue-open": c.pine, // Terminal green
      "issue-closed": c.iris, // Terminal magenta
      blocked: c.love, // Terminal red, errors
      // At 15%, as the VS Code theme tints removed text.
      "blocked-surface": `${c.love}26`,
      blocking: attention, // Warnings
      warning: attention,
      // The accent at 20%, as the GitHub userstyle's bgColor-accent-muted is
      // its own: the palette's selection background, highlightMed, is for
      // selected text.
      selection: `${c.rose}33`,
      "selection-edge": c.rose,
      "map-new": `${c.pine}66`,
      "map-moved": `${attention}66`,
      "gh-fg-muted": c.subtle, // The GitHub userstyle's fgColor-muted
      "gh-accent": c.iris, // Links, textLink.foreground
      "gh-border": c.highlightHigh,
      "gh-border-muted": c.highlightMed,
      "gh-canvas-subtle": c.surface, // textCodeBlock.background
      // Inline code: overlay, the GitHub userstyle's bgColor-muted. Its
      // bgColor-neutral-muted, overlay at 40%, is 1.03:1 on Dawn's base.
      "gh-neutral-muted": c.overlay,
      // Terminal green, as open is: not the GitHub userstyle's foam.
      "gh-success": c.pine,
      "gh-done": c.iris,
      "gh-attention": attention,
      "gh-danger": c.love,
      // Code, as the VS Code theme's token colours have it.
      "pl-comment": c.muted, // comment
      // Not constant.numeric's rose: GitHub gives this class to calls,
      // properties and operators as well as to literals, so it takes constant's
      // pine, which keyword.operator and punctuation.accessor have too.
      "pl-constant": c.pine,
      "pl-reference-link": c.pine, // constant.other.reference.link
      "pl-entity": c.rose, // entity.name
      // GitHub gives this class to type and class names.
      "pl-storage-modifier-import": c.foam, // entity.name.type
      "pl-entity-tag": c.foam, // entity.name.tag
      "pl-keyword": c.pine, // keyword
      "pl-string": c.gold, // string
      // GitHub gives this class to the classes a line refers to, such as a
      // superclass or a JSX component.
      "pl-variable": c.iris, // entity.other.inherited-class
      "pl-bracket-unmatched": c.love, // invalid
      "pl-bracket-angle": c.muted, // punctuation.definition.tag
      "pl-invalid-text": c.love, // invalid
      "pl-invalid-bg": `${c.love}26`,
      "pl-carriage-return-text": c.base,
      "pl-carriage-return-bg": c.love,
      "pl-string-regexp": c.pine, // constant.character.escape
      "pl-markup-list": c.subtle, // punctuation.definition.list
      "pl-markup-heading": c.foam, // entity.name.section
      "pl-markup-italic": c.text,
      "pl-markup-bold": c.text,
      // The text keeps its colour, as it does in the VS Code theme's diff
      // editor and the GitHub userstyle: on Dawn, markup.inserted.diff's foam
      // is 2.84:1 on its background in a code block. The backgrounds are the
      // diff editor's, and rose, the palette's git change, at the same 15%.
      "pl-markup-deleted-text": c.text,
      "pl-markup-deleted-bg": `${c.love}26`, // diffEditor.removedTextBackground
      "pl-markup-inserted-text": c.text,
      "pl-markup-inserted-bg": `${c.foam}26`, // diffEditor.insertedTextBackground
      "pl-markup-changed-text": c.text,
      "pl-markup-changed-bg": `${c.rose}26`,
      "pl-markup-ignored-text": c.base,
      "pl-markup-ignored-bg": c.muted, // Git ignored
      "pl-meta-diff-range": c.iris, // meta.diff.range
      "pl-gutter-mark": c.subtle, // editorLineNumber.foreground
    },
  };
}

const dawn: Palette = {
  base: "#faf4ed",
  surface: "#fffaf3",
  overlay: "#f2e9e1",
  muted: "#9893a5",
  subtle: "#797593",
  // The website's, darker than the #575279 that the VS Code theme still has:
  // Rosé Pine made it official in 2026.
  text: "#464261",
  love: "#b4637a",
  gold: "#ea9d34",
  rose: "#d7827e",
  pine: "#286983",
  foam: "#56949f",
  iris: "#907aa9",
  highlightLow: "#f4ede8",
  highlightMed: "#dfdad9",
  highlightHigh: "#cecacd",
};

const moon: Palette = {
  base: "#232136",
  surface: "#2a273f",
  overlay: "#393552",
  muted: "#6e6a86",
  subtle: "#908caa",
  text: "#e0def4",
  love: "#eb6f92",
  gold: "#f6c177",
  rose: "#ea9a97",
  pine: "#3e8fb0",
  foam: "#9ccfd8",
  iris: "#c4a7e7",
  highlightLow: "#2a283e",
  highlightMed: "#44415a",
  highlightHigh: "#56526e",
};

export const rosePineDawn = rosePine(
  { id: "rose-pine-dawn", name: "Rosé Pine Dawn", kind: "light" },
  dawn,
  // Dawn's gold is 2.05:1 on its base, short of the 3:1 "blocks" needs. This
  // is Bloom's gold-300 for Dawn, the lightest of its shades that passes
  // (3.31:1).
  "#bd7714",
);

export const rosePineMoon = rosePine(
  { id: "rose-pine-moon", name: "Rosé Pine Moon", kind: "dark" },
  moon,
);
