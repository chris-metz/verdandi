import { shownTheme, themeTokens, type Theme } from "../../shared/themes";

/**
 * Shows a theme's colours on the page, in place of any shown before. Each
 * token becomes a custom property on `root`, which `index.css` gives to
 * Tailwind and `github-markdown.css` uses. A dark theme also marks `root`
 * with `dark` for Tailwind's `dark:` variant.
 */
export function showTheme(root: HTMLElement, theme: Theme) {
  for (const token of themeTokens)
    root.style.setProperty(`--${token}`, theme.colors[token]);
  // Scrollbars and form controls, light or dark to match.
  root.style.colorScheme = theme.kind;
  root.classList.toggle("dark", theme.kind === "dark");
  root.dataset.theme = theme.id;
}

/**
 * Shows the theme for the operating system's appearance, and switches it
 * whenever the operating system does, until the returned function is called.
 * `media` is `(prefers-color-scheme: dark)`.
 */
export function followAppearance(
  root: HTMLElement,
  media: Pick<
    MediaQueryList,
    "matches" | "addEventListener" | "removeEventListener"
  >,
) {
  const show = () => {
    showTheme(root, shownTheme(media.matches));
  };
  show();
  media.addEventListener("change", show);
  return () => {
    media.removeEventListener("change", show);
  };
}
