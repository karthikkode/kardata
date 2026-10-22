#!/usr/bin/env bash
# Nightly pg_dump (custom format) of the kardata database.
# Keeps 7 days of dumps in ~/kardata-backups/. Runs pg_dump inside the
# kardata-db-1 container, so no host postgres client is needed.
set -euo pipefail

BACKUP_DIR="${HOME}/kardata-backups"
mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%F_%H%M)"
OUT="${BACKUP_DIR}/kardata_${STAMP}.dump"

docker exec -u postgres kardata-db-1 pg_dump -d kardata -Fc > "${OUT}"
find "${BACKUP_DIR}" -maxdepth 1 -name 'kardata_*.dump' -mtime +7 -delete
echo "wrote ${OUT} ($(du -h "${OUT}" | cut -f1))"
