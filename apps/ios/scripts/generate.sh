#!/bin/sh
# Generates Verdandi.xcodeproj from project.yml with XcodeGen
# (brew install xcodegen), and bundles the core once so Xcode lists it.
set -eu
cd "$(dirname "$0")/.."
scripts/bundle-core.sh
xcodegen generate --quiet
echo "Open apps/ios/Verdandi.xcodeproj"
