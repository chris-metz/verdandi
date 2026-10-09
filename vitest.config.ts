import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** The iOS host's stand-ins for Node's modules, as its bundle uses them. */
const shim = (name: string) =>
  fileURLToPath(new URL(`apps/ios/host/shims/${name}.ts`, import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          root: "packages/core",
          environment: "node",
        },
      },
      {
        test: {
          name: "desktop-shared",
          root: "apps/desktop/src/shared",
          environment: "node",
        },
      },
      {
        test: {
          name: "renderer",
          root: "apps/desktop/src/renderer",
          environment: "jsdom",
        },
      },
      {
        // The core on the iOS host's stand-ins, as on JavaScriptCore.
        resolve: {
          alias: [
            { find: /^node:fs\/promises$/, replacement: shim("fs-promises") },
            { find: /^node:fs$/, replacement: shim("fs") },
            { find: /^node:path$/, replacement: shim("path") },
            { find: /^node:crypto$/, replacement: shim("crypto") },
            { find: /^node:util$/, replacement: shim("util") },
            {
              find: /^node:child_process$/,
              replacement: shim("child-process"),
            },
          ],
        },
        test: {
          name: "ios-host",
          root: "apps/ios/host",
          environment: "node",
        },
      },
    ],
  },
});
