#!/bin/sh
# Puts gh's token where a Simulator's Verdandi reads it at launch, as
# GH_TOKEN: a file in the app's own temporary folder, readable by this user
# only (see LaunchOptions.environmentWithDevelopmentToken). Not the launch's
# environment, which the Simulator writes to its logs in plain text.
#
#   scripts/dev-token.sh <device> put    # the app must be installed
#   scripts/dev-token.sh <device> remove
set -eu
device="$1"
container=$(xcrun simctl get_app_container "$device" io.github.chris-metz.verdandi data)
file="$container/tmp/verdandi-dev-token"
case "${2:-put}" in
  put)
    mkdir -p "$container/tmp"
    umask 077
    if [ -n "${GH_TOKEN:-}" ]; then
      printf '%s' "$GH_TOKEN" > "$file"
    else
      gh auth token | tr -d '\n' > "$file"
    fi
    ;;
  remove)
    rm -f "$file"
    ;;
esac
