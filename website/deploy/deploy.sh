#!/usr/bin/env bash
# Build on this machine, upload a new release, switch `current` atomically, keep the last 5.
# Runs against the VM only when the owner runs it or says go. DEPLOY_HOST=local tests it on this machine.
set -euo pipefail

HOST="${DEPLOY_HOST:-opc@140.245.214.119}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/kathawin_ci_vm}"
ROOT="${DEPLOY_ROOT:-/home/opc/kardata-site}"
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
echo "deploy: release $release to $HOST:$ROOT"

run "mkdir -p '$ROOT/releases'"
copy dist/ "$ROOT/releases/$release/"
copy "$here/Caddyfile" "$ROOT/Caddyfile"
run "cd '$ROOT' && ln -sfn 'releases/$release' current.tmp && mv -Tf current.tmp current \
  && ls -1d releases/* | sort | grep -vx \"\$(readlink current)\" | head -n -$((KEEP - 1)) | xargs -r rm -rf"

# Pick up Caddyfile changes and smoke-test, if the container is already running.
if run "docker ps --format '{{.Names}}' | grep -qx kardata-site"; then
  run "docker exec kardata-site caddy reload --config /srv/Caddyfile --adapter caddyfile"
  run "docker exec kardata-site wget -qO- http://localhost/ | grep -q '<title>kardata</title>'"
  echo "deploy: kardata-site serves $release"
else
  echo "deploy: files are in place; kardata-site isn't running yet (first time: docker compose -p kardata-site up -d)"
fi
