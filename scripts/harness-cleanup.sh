#!/usr/bin/env bash
# Remove orphaned harness containers (reviews/extract/agent) older than 24h.
# Live server and database containers are never matched. Usage:
#   scripts/harness-cleanup.sh [--dry-run]
set -euo pipefail
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
now=$(date +%s)
docker ps -a --format '{{.Names}} {{.CreatedAt}}' | grep -E '^kardata-(reviews|extract|agent)-' | while read -r name created _rest; do
  epoch=$(date -d "$created" +%s 2>/dev/null || echo 0)
  age=$(( (now - epoch) / 3600 ))
  if [ "$age" -ge 24 ]; then
    echo "orphan (${age}h): $name"
    if [ "$DRY" = 0 ]; then docker rm -f "$name" >/dev/null && echo "removed $name"; fi
  fi
done
echo "harness cleanup done (dry=$DRY)"
