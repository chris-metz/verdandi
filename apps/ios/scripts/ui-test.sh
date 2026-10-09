#!/bin/sh
# Runs the UI tests on a Simulator, signed in as gh is on this Mac (GH_TOKEN
# from `gh auth token` unless it is set, passed to the test runner only),
# and saves their screenshots as PNG files.
#
#   scripts/ui-test.sh <device UDID> [test, e.g. SmokeTests] [screenshot folder]
set -eu
cd "$(dirname "$0")/.."
device="$1"
only="${2:-}"
shots="${3:-build/ui-test-shots}"
scripts/generate.sh >/dev/null
if [ -z "${GH_TOKEN:-}" ]; then
  GH_TOKEN=$(gh auth token)
fi
export TEST_RUNNER_GH_TOKEN="$GH_TOKEN"
result="build/ui-tests-$(date +%s).xcresult"
status=0
xcodebuild test -project Verdandi.xcodeproj -scheme Verdandi \
  -destination "id=$device" -derivedDataPath build/DerivedData \
  -resultBundlePath "$result" ${only:+-only-testing:VerdandiUITests/$only} -quiet || status=$?
mkdir -p "$shots"
xcrun xcresulttool export attachments --path "$result" --output-path "$shots" >/dev/null 2>&1 || true
echo "Screenshots in $shots, results in $result"
exit "$status"
