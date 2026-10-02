import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { followFonts } from "./fonts";
import "./index.css";
import { listFonts } from "./installed-fonts";
import { followTextSize } from "./text-size";
import { followAppearance } from "./theme";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element.");

// Listed as the page starts, while the window counts as visible, then
// checked against by the core.
void listFonts().then(async ({ families, failure }) => {
  if (failure === undefined)
    await window.verdandi.setInstalledFonts(families).catch(() => undefined);
});

// Rendered once the theme, fonts and text size are shown; until then, the
// window's background.
void Promise.all([
  followAppearance(
    document.documentElement,
    window.matchMedia("(prefers-color-scheme: dark)"),
    window.verdandi,
  ).ready,
  followFonts(document.documentElement, window.verdandi).ready,
  followTextSize(document.documentElement, window.verdandi).ready,
]).then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
