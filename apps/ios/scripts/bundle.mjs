// Bundles the core with its iOS host into one script for JavaScriptCore:
// `Verdandi/Resources/core.js`, which the app loads at launch. Node's
// modules are replaced by the host's stand-ins in `host/shims/`. With
// `--contract`, it bundles the host on the core's GitHub in memory instead,
// into `build/contract-core.js`, for VerdandiKit's `ContractTests`.
//
//   node scripts/bundle.mjs [--contract] [output]

import { build } from "esbuild";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shims = join(root, "host/shims");
const args = process.argv.slice(2);
const contract = args[0] === "--contract";
if (contract) args.shift();
const output = resolve(
  args[0] ??
    join(
      root,
      contract ? "build/contract-core.js" : "Verdandi/Resources/core.js",
    ),
);

await build({
  entryPoints: [
    join(root, contract ? "host/testing/contract-entry.ts" : "host/entry.ts"),
  ],
  outfile: output,
  bundle: true,
  format: "iife",
  platform: "neutral",
  // JavaScriptCore of iOS 26, which the app needs.
  target: "safari26",
  mainFields: ["module", "main"],
  conditions: ["import", "default"],
  alias: {
    "node:fs/promises": join(shims, "fs-promises.ts"),
    "node:fs": join(shims, "fs.ts"),
    "node:path": join(shims, "path.ts"),
    "node:crypto": join(shims, "crypto.ts"),
    "node:util": join(shims, "util.ts"),
    "node:child_process": join(shims, "child-process.ts"),
  },
  legalComments: "none",
  sourcemap: "inline",
  logLevel: "warning",
});
console.log(
  `Bundled the core for ${contract ? "the contract tests" : "iOS"} into ${output}`,
);
