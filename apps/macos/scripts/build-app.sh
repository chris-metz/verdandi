#!/bin/sh
# Builds Verdandi.app in apps/macos/build/: the Swift package's binary in a
# bundle, with the Icon Composer icon of the Electron app compiled by actool.
#
#   scripts/build-app.sh            debug build, fast
#   scripts/build-app.sh release    optimized
set -eu
cd "$(dirname "$0")/.."
configuration="${1:-debug}"
swift build -c "$configuration" --product Verdandi
binary="$(swift build -c "$configuration" --show-bin-path)/Verdandi"

app=build/Verdandi.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binary" "$app/Contents/MacOS/Verdandi"

icon=../desktop/build/icon.icon
if [ ! -f build/icon/Assets.car ] || [ -n "$(find "$icon" -newer build/icon/Assets.car)" ]; then
  mkdir -p build/icon
  xcrun actool "$icon" --compile build/icon --platform macosx \
    --minimum-deployment-target 26.0 --app-icon icon \
    --output-partial-info-plist build/icon/partial.plist >/dev/null
fi
cp build/icon/Assets.car build/icon/icon.icns "$app/Contents/Resources/"

cat >"$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>io.github.chris-metz.verdandi.native</string>
  <key>CFBundleName</key><string>Verdandi</string>
  <key>CFBundleDisplayName</key><string>Verdandi</string>
  <key>CFBundleExecutable</key><string>Verdandi</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundleIconName</key><string>icon</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST
codesign --force --sign - "$app" >/dev/null 2>&1 || true
echo "$PWD/$app"
