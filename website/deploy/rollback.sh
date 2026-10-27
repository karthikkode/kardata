#!/usr/bin/env bash
# Point `current` back at the release before it, then confirm kardata.co serves it. Same env as deploy.sh.
set -euo pipefail

HOST="${DEPLOY_HOST:-opc@140.245.214.119}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/kathawin_ci_vm}"
ROOT="${DEPLOY_ROOT:-/home/opc/kardata-site}"
URL="${DEPLOY_URL:-https://kardata.co}"

run() {
  if [[ "$HOST" == local ]]; then bash -c "$1"; else ssh -i "$KEY" -o BatchMode=yes "$HOST" "$1"; fi
}

prev="$(run "cd '$ROOT' && cur=\$(readlink current) \
  && prev=\$(ls -1d releases/* | sort | grep -B1 -x \"\$cur\" | head -n 1) \
  && if [ -z \"\$prev\" ] || [ \"\$prev\" = \"\$cur\" ]; then echo 'rollback: no earlier release' >&2; exit 1; fi \
  && ln -sfn \"\$prev\" current.tmp && mv -Tf current.tmp current && echo \"rollback: \$cur -> \$prev\" >&2 \
  && basename \"\$prev\"")"

[[ "$HOST" == local ]] && exit 0
live="$(curl -fsS --max-time 10 "$URL/release.txt?$RANDOM" || true)"
if [[ "$live" == "$prev" ]]; then echo "rollback: $URL serves $prev"; else echo "rollback: $URL serves '$live', expected $prev" >&2; exit 1; fi
