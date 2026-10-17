#!/bin/sh
# Runs the UI tests on a Simulator, signed in as gh is on this Mac, and
# saves their screenshots as PNG files. The token goes into a file in the
# app's own folder for the run (scripts/dev-token.sh), never into an
# environment the Simulator or Xcode would log.
#
#   scripts/ui-test.sh <device UDID> [test, e.g. SmokeTests] [screenshot folder]
set -eu
cd "$(dirname "$0")/.."
token="${GH_TOKEN:-}"
unset GH_TOKEN GITHUB_TOKEN
device="$1"
only="${2:-}"
shots="${3:-build/ui-test-shots}"
scripts/generate.sh >/dev/null
xcrun simctl boot "$device" 2>/dev/null || true
xcodebuild build-for-testing -project Verdandi.xcodeproj -scheme Verdandi \
  -destination "id=$device" -derivedDataPath build/DerivedData -quiet
xcrun simctl install "$device" build/DerivedData/Build/Products/Debug-iphonesimulator/Verdandi.app
trap 'scripts/dev-token.sh "$device" remove' EXIT
GH_TOKEN="$token" scripts/dev-token.sh "$device" put
result="build/ui-tests-$(date +%s).xcresult"
status=0
# Without diagnostics: after a failed test, xcodebuild has the Simulator
# collect them (simctl diagnose), which on Xcode 27 stops at the host's
# launchd state at times and holds the run for its 600 s timeout. The
# result bundle keeps the failures and screenshots without them.
xcodebuild test-without-building -project Verdandi.xcodeproj -scheme Verdandi \
  -destination "id=$device" -derivedDataPath build/DerivedData \
  -resultBundlePath "$result" -collect-test-diagnostics never ${only:+-only-testing:VerdandiUITests/$only} -quiet || status=$?
mkdir -p "$shots"
xcrun xcresulttool export attachments --path "$result" --output-path "$shots" >/dev/null 2>&1 || true
echo "Screenshots in $shots, results in $result"
exit "$status"
