#!/bin/sh
# Builds one of the two apps and installs it as /Applications/Verdandi.app,
# in place of whichever Verdandi is there: both apps are called
# Verdandi.app, so they take turns in that one place. They share
# settings.json, and keep the rest apart by bundle ID.
#
#   ./install-app.sh macos       the native app, optimized
#   ./install-app.sh electron    the Electron app
#
# It quits any Verdandi that runs, either app, and starts the new one.
set -eu
cd "$(dirname "$0")"

case "${1:-}" in
  macos)
    macos/scripts/build-app.sh release
    built=macos/build/Verdandi.app
    ;;
  electron)
    (cd electron && pnpm install --frozen-lockfile && pnpm package)
    if [ "$(uname -m)" = arm64 ]; then
      built=electron/apps/desktop/dist/mac-arm64/Verdandi.app
    else
      built=electron/apps/desktop/dist/mac/Verdandi.app
    fi
    ;;
  *)
    echo "Usage: $0 macos|electron" >&2
    exit 2
    ;;
esac

running() { [ -n "$(lsappinfo find bundleid="$1")" ]; }

# An app replaced as it runs goes on running from deleted files, and the two
# apps should not run at once: quit both, as Quit in the menu does.
for id in io.github.chris-metz.verdandi.native io.github.chris-metz.verdandi; do
  running "$id" || continue
  osascript -e "tell application id \"$id\" to quit"
  for _ in $(seq 1 50); do
    running "$id" || break
    sleep 0.2
  done
  if running "$id"; then
    echo "Verdandi ($id) did not quit. Quit it and run this again." >&2
    exit 1
  fi
done

# Copy first, so that a failed copy leaves the installed app as it was.
target=/Applications/Verdandi.app
staging=/Applications/.Verdandi.app.installing
rm -rf "$staging"
trap 'rm -rf "$staging"' EXIT
ditto "$built" "$staging"
rm -rf "$target"
mv "$staging" "$target"

# The path may have held the other app, under another bundle ID.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$target"
open "$target"
echo "$target"
