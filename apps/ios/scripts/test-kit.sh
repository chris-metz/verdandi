#!/bin/sh
# Bundles the core, then runs VerdandiKit's tests on this Mac, where
# JavaScriptCore runs it as on iOS.
set -eu
cd "$(dirname "$0")/.."
node scripts/bundle.mjs
swift test --package-path VerdandiKit "$@"
