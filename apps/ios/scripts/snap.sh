#!/bin/sh
# Saves a Simulator's screen: scripts/snap.sh out.png [device] [seconds]
# waits the seconds first (default 0), e.g. for a launch to load.
set -eu
out="$1"
device="${2:-booted}"
sleep "${3:-0}"
xcrun simctl io "$device" screenshot --type=png "$out" >/dev/null 2>&1
echo "$out"
