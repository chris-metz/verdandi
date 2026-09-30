import type { Config } from "@verdandi/core/contract";
import type { RendererContract } from "../../shared/ipc";
import { shownTheme, themeTokens, type Theme } from "../../shared/themes";
import { followConfig } from "./config";

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
 * Shows the user's light or dark theme, as the appearance says, and switches
 * it whenever the appearance or the chosen themes change, until `stop` is
 * called. `media` is `(prefers-color-scheme: dark)`, which main makes follow
 * the appearance. Nothing is shown until `config.toml` is read, so that the
 * window's background, already its theme's, shows through; `ready` settles
 * once it is, with the default themes if it cannot be.
 */
export function followAppearance(
  root: HTMLElement,
  media: Pick<
    MediaQueryList,
    "matches" | "addEventListener" | "removeEventListener"
  >,
  verdandi: Pick<RendererContract, "getConfig" | "on">,
): { ready: Promise<void>; stop: () => void } {
  let chosen: Config | undefined;
  let showing = false;
  const show = () => {
    if (showing) showTheme(root, shownTheme(media.matches, chosen));
  };
  const config = followConfig(verdandi, (state) => {
    chosen = state.config;
    show();
  });
  media.addEventListener("change", show);
  let stopped = false;
  return {
    ready: config.ready.then(() => {
      showing = !stopped;
      show();
    }),
    stop() {
      stopped = true;
      showing = false;
      config.stop();
      media.removeEventListener("change", show);
    },
  };
}
