#!/bin/sh
# Launches the built app, waits, and saves a screenshot of its window, then
# quits it. Every VERDANDI_* variable set reaches the app (see
# Sources/Verdandi/App/Debug.swift), e.g.
#
#   VERDANDI_APPEARANCE=dark VERDANDI_SELECT=repo:chris-metz/verdandi \
#     scripts/snap.sh /tmp/list-dark.png 8
#
# Arguments: the PNG to write, and how many seconds to wait after the
# window shows (default 6). Run scripts/build-app.sh first.
set -eu
cd "$(dirname "$0")/.."
out="$1"
wait="${2:-6}"
app=build/Verdandi.app/Contents/MacOS/Verdandi
[ -x "$app" ] || { echo "Build first: scripts/build-app.sh" >&2; exit 1; }
window_file="$(mktemp -t verdandi-window)"
rm -f "$window_file"
VERDANDI_ACTIVATE="${VERDANDI_ACTIVATE:-1}" VERDANDI_WINDOW_FILE="$window_file" VERDANDI_WINDOW_SIZE="${VERDANDI_WINDOW_SIZE:-1440x900}" "$app" >/dev/null 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true; rm -f "$window_file"' EXIT
for _ in $(seq 1 50); do
  [ -s "$window_file" ] && break
  sleep 0.2
done
[ -s "$window_file" ] || { echo "The window did not show." >&2; exit 1; }
sleep "$wait"
screencapture -x -o -l "$(cat "$window_file")" "$out"
echo "$out"
