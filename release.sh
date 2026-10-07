#!/bin/bash
# Builds and publishes a release (docs/adr/0009-releases-on-github-and-homebrew.md):
# the signed, notarized DMG for Macs with Apple Silicon and the unsigned
# Windows installer on GitHub Releases, and the cask in the tap. The Mac app
# is built here, so the Developer ID never leaves this Mac's keychain; the
# Windows installer is built on GitHub Actions. Nothing is published until both
# are built and verified, and --dry-run stops there.
#
#   ./release.sh [--dry-run] [--notes-file FILE] X.Y.Z
#
# The release notes are FILE. Without it, the first release gets fixed notes,
# and a later one the commits since the last release, opened in your editor.
set -euo pipefail

usage() {
    echo "Usage: $0 [--dry-run] [--notes-file FILE] X.Y.Z" >&2
    exit 2
}
fail() {
    echo "Can't release: $1" >&2
    exit 1
}
step() { printf '\n==> %s\n' "$1"; }

DRY_RUN=
NOTES_FILE=
VERSION=
while [ $# -gt 0 ]; do
    case $1 in
        --dry-run) DRY_RUN=1 ;;
        --notes-file)
            [ $# -gt 1 ] || usage
            [ -f "$2" ] || fail "no notes file at $2"
            # Absolute, since the script changes directory.
            NOTES_FILE="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
            shift
            ;;
        -*) usage ;;
        *)
            [ -z "$VERSION" ] || usage
            VERSION=$1
            ;;
    esac
    shift
done
[ -n "$VERSION" ] || usage

cd "$(dirname "$0")"

REPO=chris-metz/verdandi
TAP_REPO=chris-metz/homebrew-tap
BUNDLE_ID=io.github.chris-metz.verdandi
WORKFLOW=windows-build.yml
# The paid team's notarization key, which Pacemark's release setup stored in
# the keychain under this name (chris-metz/pacemark, scripts/setup-release.sh).
NOTARY_PROFILE=pacemark-notary

TAG="v$VERSION"
OUT=dist/release
NOTES="$OUT/release-notes.md"
CASK="$OUT/verdandi.rb"
BUILT=apps/desktop/dist
APP="$BUILT/mac-arm64/Verdandi.app"
DMG="$BUILT/Verdandi-$VERSION-arm64.dmg"
EXE="$OUT/windows/Verdandi-Setup-$VERSION.exe"

# version_above A B: whether version A is above version B, both X.Y.Z.
version_above() {
    echo "$1 $2" | awk '{
        split($1, a, "."); split($2, b, ".")
        for (i = 1; i <= 3; i++) if (a[i] != b[i]) exit !(a[i] + 0 > b[i] + 0)
        exit 1
    }'
}

# notarize FILE: submits FILE to Apple's notary service and waits for the
# verdict. Unless Apple accepts it, prints Apple's log and stops.
notarize() {
    RESULT="$(xcrun notarytool submit "$1" --keychain-profile "$NOTARY_PROFILE" \
        --wait --output-format plist)" || true
    STATUS="$(printf '%s' "$RESULT" | plutil -extract status raw -o - - 2>/dev/null)" || true
    if [ "$STATUS" != Accepted ]; then
        echo "Notarizing $1 failed${STATUS:+ with status $STATUS}." >&2
        if ID="$(printf '%s' "$RESULT" | plutil -extract id raw -o - - 2>/dev/null)"; then
            xcrun notarytool log "$ID" --keychain-profile "$NOTARY_PROFILE" >&2 || true
        else
            printf '%s\n' "$RESULT" >&2
        fi
        exit 1
    fi
    echo "Apple accepted $1"
}

# hide_identity: copies its input, with the Developer ID's holder and Team ID
# hidden, so that release logs don't carry them.
hide_identity() {
    awk -v name="$IDENTITY_HOLDER" '{
        while ((i = index($0, name)) > 0)
            $0 = substr($0, 1, i - 1) "<hidden>" substr($0, i + length(name))
        print
    }'
}

first_release_notes() {
    cat <<'EOF'
First release.

Requirements:

- A Mac with Apple Silicon and macOS 13 or later, or Windows 10 or later on x64
- GitHub CLI (`gh`) 2.81.0 or later, signed in to github.com

The Windows installer is unsigned, so Windows warns before Verdandi first starts: see [Install](https://github.com/chris-metz/verdandi#install).
EOF
}

# 1. Check everything a release needs, before building anything.
step "Checking"
echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "$VERSION isn't of the form X.Y.Z"
[ "$(git branch --show-current)" = main ] || fail "not on main"
[ -z "$(git status --porcelain)" ] || fail "the working tree isn't clean"
git fetch --quiet --tags origin main
COMMIT="$(git rev-parse HEAD)"
[ "$COMMIT" = "$(git rev-parse origin/main)" ] || fail "main isn't in sync with origin/main"
if git rev-parse --quiet --verify "refs/tags/$TAG" >/dev/null; then
    fail "the tag $TAG exists already"
fi
LAST_TAG="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null)" || LAST_TAG=
if [ -n "$LAST_TAG" ] && ! version_above "$VERSION" "${LAST_TAG#v}"; then
    fail "$VERSION isn't above the last tag $LAST_TAG"
fi
gh auth status >/dev/null 2>&1 || fail "gh isn't logged in, run gh auth login"
[ "$(gh api "repos/$TAP_REPO" --jq .permissions.push 2>/dev/null)" = true ] ||
    fail "gh can't push to $TAP_REPO"
IDENTITY_LINE="$(security find-identity -v -p codesigning |
    awk '/"Developer ID Application: / && !found { print; found = 1 }')"
[ -n "$IDENTITY_LINE" ] || fail "no Developer ID Application identity in the keychain"
DEVELOPER_ID="$(echo "$IDENTITY_LINE" | awk '{ print $2 }')"
IDENTITY_HOLDER="$(echo "$IDENTITY_LINE" | awk -F'"' '{ print $2 }')"
IDENTITY_HOLDER="${IDENTITY_HOLDER#Developer ID Application: }"
xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 ||
    fail "the notarytool profile $NOTARY_PROFILE doesn't work"
echo "Releasing $VERSION${LAST_TAG:+ after $LAST_TAG}, from ${COMMIT:0:7}"

# 2. The release notes.
step "Release notes"
rm -rf "$OUT"
mkdir -p "$OUT"
if [ -n "$NOTES_FILE" ]; then
    cp "$NOTES_FILE" "$NOTES"
elif [ -z "$LAST_TAG" ]; then
    first_release_notes >"$NOTES"
else
    [ -t 0 ] && [ -t 1 ] || fail "pass --notes-file, or run this in a terminal to edit the notes"
    {
        echo "# The release notes of Verdandi $VERSION. Lines starting with # are left out."
        echo "# Delete what users needn't read, and reword the rest for them."
        git log --reverse --no-merges --format='- %s' "$LAST_TAG..HEAD"
    } >"$NOTES.edit"
    # Unquoted: an editor may come with arguments, such as "code --wait".
    ${VISUAL:-${EDITOR:-vi}} "$NOTES.edit"
    grep -v '^#' "$NOTES.edit" >"$NOTES" || true
    rm "$NOTES.edit"
fi
grep -q '[^[:space:]]' "$NOTES" || fail "the release notes are empty"
cat "$NOTES"

# 3. Start the Windows build, which runs while the Mac app is built here.
step "Starting the Windows build on GitHub Actions"
REQUEST="$(date +%s)-$$"
gh workflow run "$WORKFLOW" --repo "$REPO" --ref main \
    -f version="$VERSION" -f commit="$COMMIT" -f request="$REQUEST" >/dev/null
RUN_ID=
for _ in $(seq 1 30); do
    RUN_ID="$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --event workflow_dispatch \
        --limit 20 --json databaseId,displayTitle \
        --jq ".[] | select(.displayTitle == \"Windows build $VERSION ($REQUEST)\") | .databaseId")"
    [ -z "$RUN_ID" ] || break
    sleep 2
done
[ -n "$RUN_ID" ] || fail "GitHub Actions didn't start the Windows build"
RUN_URL="https://github.com/$REPO/actions/runs/$RUN_ID"
echo "$RUN_URL"

# 4. Test.
step "Testing"
pnpm install --frozen-lockfile
pnpm check

# 5. Build the Mac app: electron-builder signs it with the Developer ID and the
#    hardened runtime, notarizes and staples it, then puts it in the DMG.
step "Building the Mac app"
rm -rf "$BUILT"
pnpm --filter @verdandi/desktop build
APPLE_KEYCHAIN_PROFILE="$NOTARY_PROFILE" pnpm --filter @verdandi/desktop exec electron-builder \
    --mac dmg --arm64 --publish never \
    "-c.mac.identity=$DEVELOPER_ID" "-c.extraMetadata.version=$VERSION" 2>&1 | hide_identity
[ -f "$DMG" ] || fail "electron-builder made no $DMG"
[ "$(plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist")" = "$VERSION" ] ||
    fail "$APP isn't version $VERSION"

# 6. Sign, notarize and staple the DMG too, so it also opens offline.
step "Notarizing the DMG"
codesign --sign "$DEVELOPER_ID" --timestamp "$DMG"
notarize "$DMG"
xcrun stapler staple "$DMG"

# 7. Verify the app as a user gets it: copied out of the DMG.
step "Verifying"
xcrun stapler validate "$DMG"
# Without --verbose, which would print the identity's name.
spctl --assess --type open --context context:primary-signature "$DMG"
MOUNT="$(mktemp -d)"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$MOUNT" "$DMG"
if ! { xcrun stapler validate "$MOUNT/Verdandi.app" && spctl --assess --type execute "$MOUNT/Verdandi.app"; }; then
    hdiutil detach -quiet "$MOUNT"
    fail "Gatekeeper rejects the app in $DMG"
fi
hdiutil detach -quiet "$MOUNT"
echo "Gatekeeper accepts $DMG and the app in it"

# 8. The Windows installer.
step "Waiting for the Windows build"
echo "$RUN_URL"
gh run watch "$RUN_ID" --repo "$REPO" --exit-status >/dev/null ||
    fail "the Windows build failed, see $RUN_URL"
gh run download "$RUN_ID" --repo "$REPO" --name verdandi-windows --dir "$OUT/windows"
[ -f "$EXE" ] || fail "the Windows build made no $(basename "$EXE")"
echo "Downloaded $EXE"

# 9. The cask, for the stapled DMG.
step "Writing the cask"
SHA256="$(shasum -a 256 "$DMG" | awk '{ print $1 }')"
cat >"$CASK" <<EOF
cask "verdandi" do
  version "$VERSION"
  sha256 "$SHA256"

  url "https://github.com/$REPO/releases/download/v#{version}/Verdandi-#{version}-arm64.dmg"
  name "Verdandi"
  desc "Keyboard-first desktop client for GitHub issues across many repositories"
  homepage "https://github.com/$REPO"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: :ventura
  depends_on formula: "gh"

  app "Verdandi.app"

  uninstall quit: "$BUNDLE_ID"

  zap trash: [
    "~/Library/Application Support/Verdandi",
    "~/Library/Preferences/$BUNDLE_ID.plist",
    "~/Library/Saved Application State/$BUNDLE_ID.savedState",
  ]
end
EOF
echo "Wrote $CASK"

if [ -n "$DRY_RUN" ]; then
    printf '\nDry run done: %s is notarized and verified, and %s is built.\n' "$DMG" "$EXE"
    printf 'Nothing is published.\n'
    exit
fi

# 10. Publish: the tag, the GitHub release, then the cask in the tap. A rerun
#     stops at the existing tag, so a failure here needs finishing by hand.
step "Publishing"
trap '[ $? -eq 0 ] || echo "Publishing stopped half way. Finish its remaining steps by hand from $OUT and $BUILT (the DMG, installer, release notes and cask), or delete the GitHub release and the tag $TAG and run again." >&2' EXIT
git tag -a "$TAG" -m "Verdandi $VERSION"
git push --quiet origin "$TAG"
gh release create "$TAG" "$DMG" "$EXE" --repo "$REPO" --verify-tag \
    --title "Verdandi $VERSION" --notes-file "$NOTES"

CASK_PATH=Casks/verdandi.rb
# The contents API needs the blob of the cask it replaces, if there is one.
CASK_BLOB="$(gh api "repos/$TAP_REPO/contents/$CASK_PATH" --jq .sha 2>/dev/null)" || CASK_BLOB=
set -- --method PUT "repos/$TAP_REPO/contents/$CASK_PATH" \
    -f message="verdandi $VERSION" -f content="$(base64 -i "$CASK")"
[ -z "$CASK_BLOB" ] || set -- "$@" -f sha="$CASK_BLOB"
gh api --silent "$@"
echo "Updated $CASK_PATH in $TAP_REPO"

printf '\nReleased Verdandi %s: https://github.com/%s/releases/tag/%s\n' "$VERSION" "$REPO" "$TAG"
printf 'Install it with: brew install --cask chris-metz/tap/verdandi\n'
