#!/usr/bin/env bash
# Launch the app against the Node dev worklet, with a clean window state.
#
# `-ApplePersistenceIgnoreState YES` is not optional during development: macOS remembers
# the previous run's window (keyed by a SwiftUI-generated identifier derived from the view
# tree), and after any change to the view hierarchy the restore fails and the app opens
# *no window at all*. That looks exactly like a hang.
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG="${CONFIG:-Debug}"
APP="build/Build/Products/$CONFIG/SeekDeep.app"
STATE="$HOME/Library/Saved Application State/to.seekdeep.native.savedState"

pkill -9 -f "SeekDeep.app/Contents/MacOS/SeekDeep" 2>/dev/null || true
rm -rf "$STATE"

if [ ! -d "$APP" ]; then
  echo "no $APP — run: npm run native:app"
  exit 1
fi

exec "$APP/Contents/MacOS/SeekDeep" -ApplePersistenceIgnoreState YES "$@"
