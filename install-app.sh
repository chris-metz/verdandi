#!/bin/sh
# Builds the app and installs it as /Applications/Verdandi.app.
#
#   ./install-app.sh
#
# It quits a running Verdandi first, and starts the new one.
set -eu
cd "$(dirname "$0")"

(cd electron && pnpm install --frozen-lockfile && pnpm package)
if [ "$(uname -m)" = arm64 ]; then
  built=electron/apps/desktop/dist/mac-arm64/Verdandi.app
else
  built=electron/apps/desktop/dist/mac/Verdandi.app
fi

running() { [ -n "$(lsappinfo find bundleid="$1")" ]; }

# An app replaced as it runs goes on running from deleted files: quit it, as
# Quit in the menu does.
id=io.github.chris-metz.verdandi
if running "$id"; then
  osascript -e "tell application id \"$id\" to quit"
  for _ in $(seq 1 50); do
    running "$id" || break
    sleep 0.2
  done
  if running "$id"; then
    echo "Verdandi did not quit. Quit it and run this again." >&2
    exit 1
  fi
fi

# Copy first, so that a failed copy leaves the installed app as it was.
target=/Applications/Verdandi.app
staging=/Applications/.Verdandi.app.installing
rm -rf "$staging"
trap 'rm -rf "$staging"' EXIT
ditto "$built" "$staging"
rm -rf "$target"
mv "$staging" "$target"

open "$target"
echo "$target"
