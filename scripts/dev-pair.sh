#!/usr/bin/env bash
# Launch a local DHT bootstrap plus two SeekDeep instances so two peers can
# connect on the same machine for fast iteration.
#
# Usage:
#   ./scripts/dev-pair.sh [port]        (default 40001)
#
# Ctrl+C stops both instances and the bootstrap node.
set -euo pipefail

PORT="${1:-40001}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$(mktemp -t seekdeep-dht.XXXXXX.log)"

cleanup() {
  kill "$DHT_PID" 2>/dev/null || true
  kill "$A_PID" 2>/dev/null || true
  kill "$B_PID" 2>/dev/null || true
  rm -f "$LOG"
}
trap cleanup EXIT INT TERM

echo "Starting local DHT bootstrap on 127.0.0.1:${PORT}..."
node "$DIR/scripts/local-dht.mjs" "$PORT" > "$LOG" 2>&1 &
DHT_PID=$!

for _ in $(seq 1 100); do
  grep -q "READY" "$LOG" 2>/dev/null && break
  sleep 0.2
done
if ! grep -q "READY" "$LOG" 2>/dev/null; then
  echo "Local DHT failed to start:" >&2
  cat "$LOG" >&2
  exit 1
fi
grep "READY" "$LOG"

echo "Launching instance A..."
(cd "$DIR" && pear run --no-updates --tmp-store --no-ask . --local-dht="$PORT") &
A_PID=$!

sleep 1

echo "Launching instance B..."
(cd "$DIR" && pear run --no-updates --tmp-store --no-ask . --local-dht="$PORT") &
B_PID=$!

echo
echo "Both instances are running against 127.0.0.1:${PORT}."
echo "Copy instance A's topic key into instance B and click Join Chat."
echo "Close the Pear Runtime windows or press Ctrl+C to exit."
wait
