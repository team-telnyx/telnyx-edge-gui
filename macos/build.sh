#!/bin/zsh
# Builds "Telnyx Edge.app" and "TelnyxEdge-<version>.dmg" into dist/.
# The app is universal (Apple silicon + Intel) and bundles its own Node.js,
# so the Mac it runs on needs nothing installed. Needs only the Xcode
# command line tools.
#
#   macos/build.sh            build app + dmg
#   macos/build.sh --install  build and copy the app to /Applications
#
#   NODE_VERSION=v24.21.0     Node.js release to bundle (an LTS line)
#   ARCHS="arm64 x86_64"      architectures to build
set -euo pipefail
ROOT=${0:A:h:h}
DIST="$ROOT/dist"
APP="$DIST/Telnyx Edge.app"
WORK="$DIST/.build"
CACHE="$DIST/.cache"
NODE_VERSION=${NODE_VERSION:-v24.21.0}
ARCHS=(${=ARCHS:-arm64 x86_64})
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json")
DMG="$DIST/TelnyxEdge-$VERSION.dmg"

rm -rf "$APP" "$WORK" "$DMG"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/server" "$APP/Contents/Resources/node/bin" "$WORK" "$CACHE"

echo "• compiling for ${ARCHS[*]}"
slices=()
for arch in $ARCHS; do
  swiftc -O -target "$arch-apple-macos13.0" -framework AppKit -framework WebKit -framework Security \
    -o "$WORK/TelnyxEdge-$arch" "$ROOT/macos/main.swift"
  slices+=("$WORK/TelnyxEdge-$arch")
done
lipo -create $slices -output "$APP/Contents/MacOS/TelnyxEdge"

echo "• bundling Node.js $NODE_VERSION"
node_arch() { [[ $1 == x86_64 ]] && echo x64 || echo $1; }
curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$CACHE/SHASUMS256-$NODE_VERSION.txt"
nodes=()
for arch in $ARCHS; do
  name="node-$NODE_VERSION-darwin-$(node_arch $arch)"
  tarball="$CACHE/$name.tar.gz"
  [[ -f "$tarball" ]] || curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$name.tar.gz" -o "$tarball"
  # Verify the download against the release's published checksums.
  (cd "$CACHE" && grep " $name.tar.gz\$" "SHASUMS256-$NODE_VERSION.txt" | shasum -a 256 -c --status) \
    || { echo "Checksum mismatch for $name.tar.gz"; rm -f "$tarball"; exit 1; }
  tar -xzf "$tarball" -C "$WORK" "$name/bin/node" "$name/LICENSE"
  nodes+=("$WORK/$name/bin/node")
done
# lipo keeps each slice's own signature from the Node.js project.
lipo -create $nodes -output "$APP/Contents/Resources/node/bin/node"
cp "$WORK/node-$NODE_VERSION-darwin-$(node_arch ${ARCHS[1]})/LICENSE" "$APP/Contents/Resources/node/LICENSE"

echo "• icon"
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ROOT/public/favicon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$ROOT/public/favicon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "• server files"
cp -R "$ROOT/server.js" "$ROOT/package.json" "$ROOT/lib" "$ROOT/public" "$APP/Contents/Resources/server/"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Telnyx Edge</string>
  <key>CFBundleDisplayName</key><string>Telnyx Edge</string>
  <key>CFBundleIdentifier</key><string>com.telnyx.edge-cp</string>
  <key>CFBundleExecutable</key><string>TelnyxEdge</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Control panel for Telnyx Edge Compute. Includes Node.js $NODE_VERSION.</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST

echo "• signing (ad hoc)"
codesign --force --sign - "$APP" >/dev/null
codesign --verify --strict "$APP"

echo "• disk image"
STAGE="$WORK/dmg"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname "Telnyx Edge $VERSION" -srcfolder "$STAGE" -format UDZO -ov "$DMG"
rm -rf "$WORK"

if [[ "${1:-}" == "--install" ]]; then
  rm -rf "/Applications/Telnyx Edge.app"
  cp -R "$APP" /Applications/
  echo "Installed /Applications/Telnyx Edge.app"
fi
echo "Built $APP"
echo "Built $DMG ($(du -h "$DMG" | cut -f1))"
