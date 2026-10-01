import type { ThemeCatalogue } from "../settings/port.ts";

/** The desktop app's built-in themes, as the core sees them. */
export const testThemes: ThemeCatalogue = {
  themes: [
    { id: "github-light", kind: "light" },
    { id: "github-dark", kind: "dark" },
    { id: "github-dark-dimmed", kind: "dark" },
    { id: "catppuccin-latte", kind: "light" },
    { id: "catppuccin-frappe", kind: "dark" },
    { id: "catppuccin-macchiato", kind: "dark" },
    { id: "catppuccin-mocha", kind: "dark" },
    { id: "tokyo-night-day", kind: "light" },
    { id: "tokyo-night-storm", kind: "dark" },
    { id: "tokyo-night", kind: "dark" },
    { id: "nord", kind: "dark" },
    { id: "rose-pine-dawn", kind: "light" },
    { id: "rose-pine-moon", kind: "dark" },
    { id: "solarized-light", kind: "light" },
    { id: "solarized-dark", kind: "dark" },
  ],
  defaults: { light: "github-light", dark: "github-dark" },
};
