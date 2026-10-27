#!/usr/bin/env bash
# One command from a clean checkout to live: check, upload a release, make sure the kardata-site container is up,
# switch `current` atomically, keep the last 5, then confirm kardata.co itself serves the new release.
# DEPLOY_HOST=local DEPLOY_ROOT=<dir> runs it on this machine for testing (no public check).
set -euo pipefail

HOST="${DEPLOY_HOST:-opc@140.245.214.119}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/kathawin_ci_vm}"
ROOT="${DEPLOY_ROOT:-/home/opc/kardata-site}"
URL="${DEPLOY_URL:-https://kardata.co}"
KEEP=5
here="$(cd "$(dirname "$0")" && pwd)"
front="$here/../frontend"

run() {
  if [[ "$HOST" == local ]]; then bash -c "$1"; else ssh -i "$KEY" -o BatchMode=yes "$HOST" "$1"; fi
}
copy() {
  if [[ "$HOST" == local ]]; then rsync -a --delete "$1" "$2"; else rsync -a --delete -e "ssh -i $KEY -o BatchMode=yes" "$1" "$HOST:$2"; fi
}

cd "$front"
if [[ -z "${ALLOW_DIRTY:-}" && -n "$(git status --porcelain -- ..)" ]]; then
  echo "deploy: website/ has uncommitted changes. Commit them first." >&2
  exit 1
fi

npm run check

release="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
echo "$release" > dist/release.txt
echo "deploy: release $release to $HOST:$ROOT"

run "mkdir -p '$ROOT/releases'"
copy dist/ "$ROOT/releases/$release/"
copy "$here/Caddyfile" "$ROOT/Caddyfile"
copy "$here/compose.yml" "$ROOT/compose.yml"
run "cd '$ROOT' && ln -sfn 'releases/$release' current.tmp && mv -Tf current.tmp current \
  && ls -1d releases/* | sort | grep -vx \"\$(readlink current)\" | head -n -$((KEEP - 1)) | xargs -r rm -rf"

if [[ "$HOST" == local ]]; then
  echo "deploy: local release in place at $ROOT/current"
  exit 0
fi

# Creates the container the first time, re-creates it only if compose.yml changed, else leaves it running.
run "cd '$ROOT' && docker compose -p kardata-site up -d --quiet-pull"
run "docker exec kardata-site caddy reload --config /srv/Caddyfile --adapter caddyfile"

for i in 1 2 3 4 5; do
  live="$(curl -fsS --max-time 10 "$URL/release.txt?$RANDOM" || true)"
  [[ "$live" == "$release" ]] && { echo "deploy: $URL serves $release"; exit 0; }
  sleep 2
done
echo "deploy: $URL serves '${live:-nothing}', not $release. Is kathawin's Caddy routing kardata.co to kardata-site:80?" >&2
exit 1
