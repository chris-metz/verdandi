import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    // The core ships as TypeScript source, so it is bundled, not required.
    build: { externalizeDeps: { exclude: ["@verdandi/core"] } },
  },
  preload: {
    // A sandboxed preload cannot require anything but `electron`.
    build: { externalizeDeps: false },
  },
  renderer: {
    resolve: { alias: { "@": resolve("src/renderer/src") } },
    plugins: [react(), tailwindcss()],
  },
});
