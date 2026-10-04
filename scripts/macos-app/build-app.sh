#!/bin/bash
# build-app.sh — build "City Map.app": click its icon (Dock, Launchpad, Finder) to open the map.
#
#   scripts/macos-app/build-app.sh             build → build/City Map.app (in the repo)
#   scripts/macos-app/build-app.sh --install   …and copy it to /Applications (replaces an old copy)
#   APP_DIR=~/Applications scripts/macos-app/build-app.sh --install    install somewhere else
#
# Then drag it from Applications to the Dock to keep it there.
#
# WHAT THE APP IS
#   A stay-open AppleScript applet (CityMap.applescript, compiled with osacompile) plus
#   Contents/Resources/:
#     citymap-ctl.sh     starts ./run-db.sh in the background, reports when the map is up,
#                        stops the server it started when you quit the app
#     project-root.txt   the path of THIS repo — the map's code, data, Docker setup and
#                        Python env stay here (several GB, plus Docker volumes), so the app
#                        points at them rather than copying them
#     applet.icns        the icon, made from AppIcon.png (make_icon.py redraws it)
#   Log: ~/Library/Logs/CityMap/server.log
#
# TRAP  Move or rename the repo and the app can't find it — it says so. Re-run this
#       script from the new location.
#
# Needs only macOS tools: osacompile, sips, iconutil, plutil, codesign.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# ADJUSTABLE: app name (Dock label) and bundle id. Changing the id makes macOS treat it
# as a new app (Dock entry, Login Items, notification permission all start over).
APP_NAME="City Map"
BUNDLE_ID="com.deeptechhouse.citymap"
OUT_DIR="$ROOT/build"
APP="$OUT_DIR/$APP_NAME.app"
# ADJUSTABLE: install location for --install. ~/Applications needs no admin rights.
APP_DIR="${APP_DIR:-/Applications}"

INSTALL=0
# O(a) time, O(1) space — a = command-line arguments
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=1 ;;
    *) echo "unknown option: $arg  (usage: $0 [--install])" >&2; exit 2 ;;
  esac
done
# O(1) time, O(1) space — n = 1 message
say() { printf '\033[1m%s\033[0m\n' "$*"; }

[ -x "$ROOT/run-db.sh" ] || { echo "run-db.sh not found in $ROOT" >&2; exit 1; }

# ---- 1. Compile the applet (-s = stay open: the app stays in the Dock while the map runs)
say "Compiling $APP_NAME.app"
mkdir -p "$OUT_DIR"
rm -rf "$APP"
osacompile -s -o "$APP" "$HERE/CityMap.applescript"

# ---- 2. Resources: launcher helper, repo path, icon ------------------------------------
RES="$APP/Contents/Resources"
install -m 0755 "$HERE/citymap-ctl.sh" "$RES/citymap-ctl.sh"
printf '%s\n' "$ROOT" >"$RES/project-root.txt"

ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
# O(k) time, O(1) space — k = 5 icon sizes (each also written at @2x)
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" "$HERE/AppIcon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$HERE/AppIcon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RES/applet.icns"
rm -rf "$(dirname "$ICONSET")"

# ---- 3. Info.plist: name, id, version -------------------------------------------------
PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleDisplayName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$PLIST"
plutil -replace CFBundleShortVersionString -string "1.0" "$PLIST"
plutil -replace CFBundleVersion -string "$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo 1)" "$PLIST"
plutil -replace NSHumanReadableCopyright -string "Interactive City Map" "$PLIST"

# ---- 4. Re-sign (ad hoc): the edits above invalidated osacompile's signature ----------
codesign --force --deep --sign - "$APP" >/dev/null 2>&1
codesign --verify "$APP"

# TRAP (seen 2026-10-04, macOS 12): the applet hung — Quit timed out with -1712 — with its
# main thread deadlocked in AppKit's window-state restoration (NSPersistentUIManager
# refreshEncryptionKey → window snapshotter). The app has no windows worth restoring,
# so opt out of "Resume" state for this bundle id.
defaults write "$BUNDLE_ID" ApplePersistenceIgnoreState -bool YES
defaults write "$BUNDLE_ID" NSQuitAlwaysKeepsWindows -bool NO
rm -rf "$HOME/Library/Saved Application State/$BUNDLE_ID.savedState"
touch "$APP"  # nudge Finder/Dock to pick up the new icon
say "Built  $APP"

if [ "$INSTALL" = 1 ]; then
  DEST="$APP_DIR/$APP_NAME.app"
  mkdir -p "$APP_DIR"
  # Quit a running copy first (that also stops the server it started). The `is running`
  # guard matters: a bare `tell application … to quit` LAUNCHES the app if it isn't open.
  osascript -e "if application \"$APP_NAME\" is running then tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  rm -rf "$DEST"
  ditto "$APP" "$DEST"
  # Re-register with Launch Services so Spotlight/Launchpad show the new icon at once.
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST" >/dev/null 2>&1 || true
  say "Installed  $DEST   — drag it to the Dock to keep it there"
fi
