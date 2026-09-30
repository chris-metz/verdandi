import type { Theme } from "./index";

/*
 * Nord, from its palette (https://github.com/nordtheme/nord, `src/nord.css`
 * as of 005e87e) and the roles its documentation gives each colour
 * (https://www.nordtheme.com/docs/colors-and-palettes). Where it names none,
 * a token takes the colour of the key or scope named in its comment, from
 * Nord's VS Code theme (https://github.com/nordtheme/visual-studio-code,
 * v0.19.0, `themes/nord-color-theme.json`); where a token departs from both,
 * its comment says why. Nord has only this dark theme.
 *
 * The palette and the VS Code theme each come with this notice. The first
 * copyright line is the palette's, the other two the VS Code theme's:
 *
 * MIT License (MIT)
 *
 * Copyright (c) 2016-present Sven Greb <development@svengreb.de> (https://www.svengreb.de)
 * Copyright (C) 2017-present Arctic Ice Studio <development@arcticicestudio.com> (https://www.arcticicestudio.com)
 * Copyright (C) 2017-present Sven Greb <development@svengreb.de> (https://www.svengreb.de)
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

/** Nord's palette, by its own names, and two shades its VS Code theme adds. */
const c = {
  // Polar Night, the backgrounds.
  nord0: "#2e3440",
  nord1: "#3b4252",
  nord2: "#434c5e",
  nord3: "#4c566a",
  // Snow Storm, the text.
  nord4: "#d8dee9",
  nord5: "#e5e9f0",
  nord6: "#eceff4",
  // Frost, the blues.
  nord7: "#8fbcbb",
  nord8: "#88c0d0",
  nord9: "#81a1c1",
  nord10: "#5e81ac",
  // Aurora: red, orange, yellow, green and purple.
  nord11: "#bf616a",
  nord12: "#d08770",
  nord13: "#ebcb8b",
  nord14: "#a3be8c",
  nord15: "#b48ead",
  // Not in the palette, but in the VS Code theme: its comments, a brighter
  // nord3, and its input.placeholderForeground, nord4 at 60%, here flattened
  // onto nord0.
  comment: "#616e88",
  placeholder: "#949aa5",
};

/**
 * Nord as a theme. Nord8, its primary accent, marks the selection and focus.
 * The sidebar is the background, a nord1 border between them, as the VS Code
 * theme has it.
 */
export const nord: Theme = {
  id: "nord",
  name: "Nord",
  kind: "dark",
  colors: {
    background: c.nord0, // Backgrounds
    foreground: c.nord4, // editor.foreground
    card: c.nord0,
    "card-foreground": c.nord4,
    popover: c.nord1, // Modals and floating popups
    "popover-foreground": c.nord4,
    primary: c.nord8, // Primary UI elements
    "primary-foreground": c.nord0, // button.foreground
    secondary: c.nord2, // button.secondaryBackground
    "secondary-foreground": c.nord4,
    // The active line, and selection and text highlighting.
    muted: c.nord2,
    // Nord's subtle text is nord4 faded: Atom's @text-color-subtle and VS
    // Code's inactive tabs are nord4 at 40%, 2.82:1 on nord0, so this is the
    // next shade the VS Code theme gives. Not a brighter nord3, the comments'
    // colour: nord-vim's first that passes, #6f7d98, is 3.01:1 on nord0 but
    // 2.08:1 on muted, a selected row.
    "muted-foreground": c.placeholder,
    accent: c.nord3, // button.secondaryHoverBackground
    "accent-foreground": c.nord4,
    destructive: c.nord11, // Errors
    // Not the nord1 of the VS Code theme's borders: that is the popovers'
    // colour, so their dividers would vanish.
    border: c.nord2,
    input: c.nord2,
    ring: c.nord8,
    sidebar: c.nord0, // sideBar.background
    "sidebar-foreground": c.nord4,
    "sidebar-primary": c.nord8,
    "sidebar-primary-foreground": c.nord0,
    "sidebar-accent": c.nord2, // list.inactiveSelectionBackground
    "sidebar-accent-foreground": c.nord4,
    "sidebar-border": c.nord1, // sideBar.border
    "sidebar-ring": c.nord8,
    // widget.shadow: Nord has no colour darker than its background.
    overlay: "#00000066",
    "issue-open": c.nord14, // Success
    "issue-closed": c.nord15, // Aurora's purple
    blocked: c.nord11, // Errors
    // At 10%, as GitHub Dark's is: Nord gives errors no background.
    "blocked-surface": `${c.nord11}1a`,
    blocking: c.nord13, // Warnings
    warning: c.nord13,
    // The accent at 20%. The VS Code theme's list.focusBackground, at 60%,
    // leaves the foreground at 2.82:1.
    selection: `${c.nord8}33`,
    "selection-edge": c.nord8,
    "map-new": `${c.nord14}66`,
    "map-moved": `${c.nord13}66`,
    "gh-fg-muted": c.placeholder,
    "gh-accent": c.nord8, // Markup link URLs, textLink.foreground
    "gh-border": c.nord2,
    "gh-border-muted": c.nord1,
    // Elevated UI elements: code blocks stand out from the page.
    "gh-canvas-subtle": c.nord1,
    "gh-neutral-muted": c.nord3, // textCodeBlock.background
    "gh-success": c.nord14,
    "gh-done": c.nord15,
    "gh-attention": c.nord13,
    "gh-danger": c.nord11,
    // Code, as the VS Code theme's token colours have it.
    "pl-comment": c.comment, // comment
    // Not constant.numeric's nord15: GitHub gives this class to calls,
    // properties and operators as well as to literals, so it takes the colour
    // Nord gives calls, which support.function and JavaScript's object-literal
    // keys have.
    "pl-constant": c.nord8,
    "pl-reference-link": c.nord8, // Markup link URLs
    "pl-entity": c.nord8, // entity.name.function
    // GitHub gives this class to type and class names.
    "pl-storage-modifier-import": c.nord7, // entity.name.class, support.type
    "pl-entity-tag": c.nord9, // entity.name.tag
    "pl-keyword": c.nord9, // keyword
    "pl-string": c.nord14, // string
    // GitHub gives this class to the classes a line refers to, such as a
    // superclass or a JSX component.
    "pl-variable": c.nord7, // entity.other.inherited-class, support.class
    // editorBracketHighlight.unexpectedBracket.foreground
    "pl-bracket-unmatched": c.nord11,
    "pl-bracket-angle": c.nord9, // punctuation.definition.tag
    "pl-invalid-text": c.nord11, // Errors
    "pl-invalid-bg": `${c.nord11}1a`,
    // Elevated text: the background, as the other themes have it, is 3.05:1 on
    // nord11.
    "pl-carriage-return-text": c.nord6,
    "pl-carriage-return-bg": c.nord11,
    "pl-string-regexp": c.nord13, // constant.character.escape
    "pl-markup-list": c.nord9, // beginning.punctuation.definition.list
    "pl-markup-heading": c.nord8, // markup.heading
    "pl-markup-italic": c.nord4,
    "pl-markup-bold": c.nord4,
    // The text keeps its colour, as it does in the VS Code theme's diff
    // editor: markup.deleted's nord11 is under 2:1 on its background in a code
    // block. The backgrounds are the palette's git colours: diffEditor's
    // removed one, and its inserted one in green rather than its nord9.
    "pl-markup-deleted-text": c.nord4,
    "pl-markup-deleted-bg": `${c.nord11}4d`, // diffEditor.removedTextBackground
    "pl-markup-inserted-text": c.nord4,
    "pl-markup-inserted-bg": `${c.nord14}33`,
    "pl-markup-changed-text": c.nord4,
    "pl-markup-changed-bg": `${c.nord13}33`,
    "pl-markup-ignored-text": c.nord0,
    "pl-markup-ignored-bg": c.nord9,
    "pl-meta-diff-range": c.nord7, // meta.diff.range.context
    "pl-gutter-mark": c.nord3, // editorLineNumber.foreground
  },
};
