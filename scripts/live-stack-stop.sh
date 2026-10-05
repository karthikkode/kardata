#!/usr/bin/env bash
# Stops ONLY the PIDs recorded by scripts/live-stack.sh. Never touches
# compose containers or any other process.
set -euo pipefail

LIVE_DIR="${TMPDIR:-/tmp}/kardata-live"
PIDS_FILE="$LIVE_DIR/pids"
if [ ! -f "$PIDS_FILE" ]; then
  echo "no pids file at $PIDS_FILE; nothing to stop"
  exit 0
fi
# shellcheck disable=SC2046
kill $(cat "$PIDS_FILE") 2>/dev/null || true
sleep 2
# shellcheck disable=SC2046
kill -9 $(cat "$PIDS_FILE") 2>/dev/null || true
rm -f "$PIDS_FILE"
echo "live stack stopped"
