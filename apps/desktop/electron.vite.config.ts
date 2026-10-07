import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  // Every package is a devDependency, so electron-vite bundles it, the core's
  // TypeScript source included: the packaged app needs no node_modules.
  main: {},
  preload: {
    // A sandboxed preload cannot require anything but `electron`.
    build: { externalizeDeps: false },
  },
  renderer: {
    resolve: { alias: { "@": resolve("src/renderer/src") } },
    plugins: [react(), tailwindcss()],
  },
});
