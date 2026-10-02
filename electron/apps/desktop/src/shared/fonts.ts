/**
 * The font families Verdandi ships, each the default for its use: by the
 * name the user sees and `config.toml` holds, and by the name of the face
 * the app bundles, with the generic family behind it.
 */
export const shippedFonts = {
  interfaceFont: {
    family: "Geist",
    face: "Geist Variable",
    generic: "sans-serif",
  },
  codeFont: {
    family: "Geist Mono",
    face: "Geist Mono Variable",
    generic: "monospace",
  },
} as const;

/** The default fonts by family, as the core names them. */
export const fontDefaults = {
  interfaceFont: shippedFonts.interfaceFont.family,
  codeFont: shippedFonts.codeFont.family,
};
