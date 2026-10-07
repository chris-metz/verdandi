import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["**/out/", "**/dist/"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["vitest.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Agent skills' and the desktop app's scripts run on Node (or Electron),
    // and may pass functions to a page.
    files: [".agents/**/*.mjs", "apps/desktop/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        document: "readonly",
      },
    },
  },
  {
    files: ["apps/desktop/src/renderer/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
  },
  prettier,
);
