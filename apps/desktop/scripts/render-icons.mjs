// Renders Verdandi's icon from `build/icon.svg` into the PNGs committed next
// to it: `build/icon.png` for Linux, Windows, dev mode and the README, and
// the repository's social preview in `docs/`. Runs in Electron, so it needs
// no other browser: `pnpm icons`.
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow } from "electron";

const desktop = resolve(import.meta.dirname, "..");
const repo = resolve(desktop, "../..");
const iconSvg = join(desktop, "build/icon.svg");
const geist = join(
  desktop,
  "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
);

/** The social preview: icon, name and what Verdandi is, 1280 × 640. */
function socialPreview() {
  const icon = readFileSync(iconSvg, "utf8");
  return `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: Geist; src: url("data:font/woff2;base64,${readFileSync(geist, "base64")}") format("woff2"); font-weight: 100 900; }
  html, body { margin: 0; width: 1280px; height: 640px; overflow: hidden; }
  body {
    display: flex; align-items: center; gap: 56px; box-sizing: border-box; padding: 0 120px 0 96px;
    background: linear-gradient(#22345a, #0f1a2f); color: #efe9da; font-family: Geist, sans-serif;
  }
  svg { width: 340px; height: 340px; flex: none; }
  h1 { margin: 0; font-size: 116px; font-weight: 600; letter-spacing: -0.03em; line-height: 1; }
  p { margin: 22px 0 0; font-size: 34px; line-height: 1.35; opacity: 0.75; }
</style>
${icon}
<div>
  <h1>Verdandi</h1>
  <p>A keyboard-first desktop client for GitHub issues across many repositories.</p>
</div>`;
}

/** Renders a page at its CSS size into a PNG, in the one window used. */
async function render(window, url, width, height) {
  window.setContentSize(width, height);
  await window.loadURL(url);
  await window.webContents.executeJavaScript(
    "document.fonts.ready.then(() => true)",
  );
  const image = await window.webContents.capturePage();
  return image.resize({ width, height, quality: "best" }).toPNG();
}

// An ES module entry must not await readiness at its top level: Electron
// emits `ready` only once the entry has finished loading.
void app.whenReady().then(async () => {
  // One window for all renders: a second one fails to load in some sandboxes.
  const window = new BrowserWindow({
    show: false,
    useContentSize: true,
    transparent: true,
    frame: false,
  });
  try {
    writeFileSync(
      join(desktop, "build/icon.png"),
      await render(window, pathToFileURL(iconSvg).href, 1024, 1024),
    );
    writeFileSync(
      join(repo, "docs/social-preview.png"),
      await render(
        window,
        `data:text/html;base64,${Buffer.from(socialPreview()).toString("base64")}`,
        1280,
        640,
      ),
    );
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
