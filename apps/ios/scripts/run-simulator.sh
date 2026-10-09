#!/bin/sh
# Builds the app, installs it on a Simulator and launches it, signed in as
# gh is on this Mac: GH_TOKEN comes from `gh auth token` unless it is set,
# and goes only into the app's environment. Any VERDANDI_* variable set
# here is passed on too (see Verdandi/App/LaunchOptions.swift).
#
#   scripts/run-simulator.sh [device] [--no-build]
#   VERDANDI_SELECT=repo:chris-metz/verdandi scripts/run-simulator.sh "iPhone 18 Pro Max"
#
# The device is a name or UDID; it is booted if need be. Without one, the
# first booted device is used, or the iPad Pro 13-inch.
set -eu
cd "$(dirname "$0")/.."
device="${1:-}"
build=1
[ "${2:-}" = "--no-build" ] && build=0
if [ -z "$device" ]; then
  device=$(xcrun simctl list devices booted | sed -n 's/^ *\(.*\) (\([0-9A-F-]*\)) (Booted).*/\2/p' | head -n 1)
  [ -n "$device" ] || device="iPad Pro 13-inch (M5)"
fi
xcrun simctl boot "$device" 2>/dev/null || true
derived="build/DerivedData"
if [ "$build" = 1 ]; then
  [ -d Verdandi.xcodeproj ] || scripts/generate.sh
  xcodebuild -project Verdandi.xcodeproj -scheme Verdandi \
    -destination "platform=iOS Simulator,id=$(xcrun simctl list devices | grep -F "$device" | grep -o '[0-9A-F]\{8\}-[0-9A-F-]*' | head -n 1)" \
    -derivedDataPath "$derived" build -quiet
fi
app="$derived/Build/Products/Debug-iphonesimulator/Verdandi.app"
xcrun simctl install "$device" "$app"
xcrun simctl terminate "$device" io.github.chris-metz.verdandi 2>/dev/null || true
if [ -z "${GH_TOKEN:-}" ]; then
  GH_TOKEN=$(gh auth token)
fi
export SIMCTL_CHILD_GH_TOKEN="$GH_TOKEN"
for name in $(env | sed -n 's/^\(VERDANDI_[A-Z_]*\)=.*/\1/p'); do
  eval "export SIMCTL_CHILD_$name=\"\$$name\""
done
xcrun simctl launch "$device" io.github.chris-metz.verdandi >/dev/null
echo "Launched Verdandi on $device"
