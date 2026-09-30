import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { followAppearance } from "./theme";

followAppearance(
  document.documentElement,
  window.matchMedia("(prefers-color-scheme: dark)"),
);

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
