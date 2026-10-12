#!/bin/sh
# Bundles the core, as the app runs it and on the core's GitHub in memory
# for the contract tests, then runs VerdandiKit's tests on this Mac, where
# JavaScriptCore runs it as on iOS.
set -eu
cd "$(dirname "$0")/.."
node scripts/bundle.mjs
node scripts/bundle.mjs --contract
swift test --package-path VerdandiKit "$@"
