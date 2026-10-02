import type { Config } from "@verdandi/core/contract";
import { shippedFonts } from "../../shared/fonts";
import type { RendererContract } from "../../shared/ipc";
import { followConfig } from "./config";

/** What a font is for: the interface, or code. */
export type FontUse = keyof typeof shippedFonts;

/**
 * A CSS `font-family` list: the family, if one is chosen, then the default
 * Verdandi ships for its use, so that a family not installed falls back by
 * itself. A family Verdandi ships for the other use is drawn in the face it
 * bundles, unless it is installed too.
 */
export function fontStack(family: string | null, use: FontUse): string {
  const shipped = shippedFonts[use];
  const name = family?.toLowerCase();
  const bundled = Object.values(shippedFonts).find(
    (font) => font !== shipped && font.family.toLowerCase() === name,
  );
  return [
    ...(family === null ? [] : [cssString(family)]),
    ...(bundled ? [cssString(bundled.face)] : []),
    cssString(shipped.face),
    shipped.generic,
  ].join(", ");
}

/** A name as a quoted CSS string, which may hold any character. */
export function cssString(name: string): string {
  const escaped = name.replace(/["\\\n\r\f]/g, (character) =>
    character === '"' || character === "\\"
      ? `\\${character}`
      : `\\${character.charCodeAt(0).toString(16)} `,
  );
  return `"${escaped}"`;
}

/**
 * Shows the chosen fonts on the page: each use's `font-family` list becomes
 * a custom property on `root`, which `index.css` gives to Tailwind's
 * `font-sans` and `font-mono`, and `github-markdown.css` to code.
 */
export function showFonts(
  root: HTMLElement,
  config: Pick<Config, "interfaceFont" | "codeFont">,
) {
  root.style.setProperty(
    "--interface-font",
    fontStack(config.interfaceFont, "interfaceFont"),
  );
  root.style.setProperty("--code-font", fontStack(config.codeFont, "codeFont"));
}

/**
 * Shows the chosen fonts, and switches them whenever they change, until
 * `stop` is called. `ready` settles once `config.toml` is read; until then,
 * and if it cannot be, the default fonts show.
 */
export function followFonts(
  root: HTMLElement,
  verdandi: Pick<RendererContract, "getConfig" | "on">,
): { ready: Promise<void>; stop: () => void } {
  return followConfig(verdandi, (state) => {
    showFonts(root, state.config);
  });
}
