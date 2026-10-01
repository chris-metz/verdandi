import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { followAppearance } from "./theme";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element.");

// Rendered once the theme is shown; until then, the window's background.
void followAppearance(
  document.documentElement,
  window.matchMedia("(prefers-color-scheme: dark)"),
  window.verdandi,
).ready.then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
