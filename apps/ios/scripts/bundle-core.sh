#!/bin/sh
# Bundles the core into Verdandi/Resources/core.js; Xcode runs it before it
# builds the app. Xcode's environment lacks the shell's PATH, so Node is
# looked for where mise and Homebrew put it.
set -eu
PATH="$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js is needed to bundle the core. Install it (see mise.toml), then run pnpm install." >&2
  exit 1
fi
if [ ! -d ../../node_modules ]; then
  echo "error: Run pnpm install in the repository first." >&2
  exit 1
fi
node scripts/bundle.mjs
