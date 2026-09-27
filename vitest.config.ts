import { defineConfig } from "vitest/config";

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
          name: "renderer",
          root: "apps/desktop/src/renderer",
          environment: "jsdom",
        },
      },
    ],
  },
});
