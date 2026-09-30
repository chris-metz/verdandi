import type { ThemeCatalogue } from "../settings/port.ts";

/** The desktop app's built-in themes, as the core sees them. */
export const testThemes: ThemeCatalogue = {
  themes: [
    { id: "github-light", kind: "light" },
    { id: "github-dark", kind: "dark" },
    { id: "github-dark-dimmed", kind: "dark" },
  ],
  defaults: { light: "github-light", dark: "github-dark" },
};
