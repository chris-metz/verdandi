#!/bin/sh
# Launches the built app, waits, and saves a screenshot of its window, then
# quits it. Every VERDANDI_* variable set reaches the app (see
# Sources/Verdandi/App/Debug.swift), e.g.
#
#   VERDANDI_APPEARANCE=dark VERDANDI_SELECT=repo:chris-metz/verdandi \
#     scripts/snap.sh /tmp/list-dark.png 8
#   VERDANDI_SETUP=gh-missing scripts/snap.sh /tmp/setup.png 3
#   VERDANDI_SETTINGS=github scripts/snap.sh /tmp/settings.png 3
#   VERDANDI_POPOVER=rate-limits scripts/snap.sh /tmp/limits.png 6
#
# Arguments: the PNG to write, and how many seconds to wait after the
# window shows (default 6). Run scripts/build-app.sh first.
#
# It saves the main window, or Settings with VERDANDI_SETTINGS, About with
# VERDANDI_ABOUT, the rate-limit popover with VERDANDI_POPOVER;
# VERDANDI_SNAP=main|settings|about|popover picks one.
# SNAP_REGION=1 saves the window's area of the screen instead of the
# window alone, so that what floats over it, such as a popover, shows too;
# SNAP_MARGIN=40 takes that many points around it as well.
#
# The window shows as an inactive one. VERDANDI_ACTIVATE=1 brings it to the
# front as the active window, when macOS lets it: it then takes the
# keyboard from the app you are typing in, so what you type goes to it.
set -eu
cd "$(dirname "$0")/.."
out="$1"
wait="${2:-6}"
app=build/Verdandi.app/Contents/MacOS/Verdandi
[ -x "$app" ] || { echo "Build first: scripts/build-app.sh" >&2; exit 1; }
window_file="$(mktemp -t verdandi-window)"
rm -f "$window_file"
VERDANDI_ACTIVATE="${VERDANDI_ACTIVATE:-0}" VERDANDI_WINDOW_FILE="$window_file" VERDANDI_WINDOW_SIZE="${VERDANDI_WINDOW_SIZE:-1440x900}" "$app" >/dev/null 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true; rm -f "$window_file"' EXIT
for _ in $(seq 1 50); do
  [ -s "$window_file" ] && break
  sleep 0.2
done
[ -s "$window_file" ] || { echo "The window did not show." >&2; exit 1; }
sleep "$wait"
# The app writes "number x y width height", and rewrites it as the window
# moves or resizes.
read -r number x y width height <"$window_file" || true
if [ "${SNAP_REGION:-0}" = 1 ]; then
  margin="${SNAP_MARGIN:-0}"
  screencapture -x -R "$((x - margin)),$((y - margin)),$((width + 2 * margin)),$((height + 2 * margin))" "$out"
else
  screencapture -x -o -l "$number" "$out"
fi
echo "$out"
