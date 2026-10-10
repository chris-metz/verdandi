#!/bin/sh
# Builds the app, installs it on a Simulator and launches it, signed in as
# gh is on this Mac: GH_TOKEN, or else `gh auth token`, goes into a file in
# the app's own folder that it reads at launch and deletes
# (scripts/dev-token.sh), never into an environment the Simulator or Xcode
# would log. Any VERDANDI_* variable set here is passed on (see
# Verdandi/App/LaunchOptions.swift).
#
#   scripts/run-simulator.sh [device] [--no-build]
#   VERDANDI_SELECT=repo:chris-metz/verdandi scripts/run-simulator.sh "iPhone 18 Pro Max"
#
# The device is a name or UDID; it is booted if need be. Without one, the
# first booted device is used, or the iPad Pro 13-inch.
set -eu
cd "$(dirname "$0")/.."
token="${GH_TOKEN:-}"
unset GH_TOKEN GITHUB_TOKEN
device="${1:-}"
build=1
[ "${2:-}" = "--no-build" ] && build=0
if [ -z "$device" ]; then
  device=$(xcrun simctl list devices booted | sed -n 's/^ *\(.*\) (\([0-9A-F-]*\)) (Booted).*/\2/p' | head -n 1)
  [ -n "$device" ] || device="iPad Pro 13-inch (M5)"
fi
xcrun simctl boot "$device" 2>/dev/null || true
device=$(xcrun simctl list devices | grep -F "$device" | grep -o '[0-9A-F]\{8\}-[0-9A-F-]*' | head -n 1)
derived="build/DerivedData"
if [ "$build" = 1 ]; then
  # New files join the project only as it is generated again.
  scripts/generate.sh >/dev/null
  xcodebuild -project Verdandi.xcodeproj -scheme Verdandi \
    -destination "platform=iOS Simulator,id=$device" \
    -derivedDataPath "$derived" build -quiet
fi
app="$derived/Build/Products/Debug-iphonesimulator/Verdandi.app"
xcrun simctl install "$device" "$app"
xcrun simctl terminate "$device" io.github.chris-metz.verdandi 2>/dev/null || true
GH_TOKEN="$token" scripts/dev-token.sh "$device" put
# Not these: the Simulator logs a launch's environment, and the first
# would carry a token, the second keep the token's file for good.
for name in $(env | sed -n 's/^\(VERDANDI_[A-Z_]*\)=.*/\1/p' | grep -v -e '^VERDANDI_SIGN_IN$' -e '^VERDANDI_KEEP_DEV_TOKEN$'); do
  eval "export SIMCTL_CHILD_$name=\"\$$name\""
done
xcrun simctl launch "$device" io.github.chris-metz.verdandi >/dev/null
echo "Launched Verdandi on $device"
# The app deletes the token's file as it reads it at launch; one it did
# not read, as it crashed first, goes too, rather than wait for a launch
# from Xcode.
container=$(xcrun simctl get_app_container "$device" io.github.chris-metz.verdandi data)
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  [ -e "$container/tmp/verdandi-dev-token" ] || exit 0
  sleep 1
done
scripts/dev-token.sh "$device" remove
