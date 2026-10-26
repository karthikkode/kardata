#!/usr/bin/env bash
# Point `current` back at the release before it. Same env as deploy.sh.
set -euo pipefail

HOST="${DEPLOY_HOST:-opc@140.245.214.119}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/kathawin_ci_vm}"
ROOT="${DEPLOY_ROOT:-/home/opc/kardata-site}"

run() {
  if [[ "$HOST" == local ]]; then bash -c "$1"; else ssh -i "$KEY" -o BatchMode=yes "$HOST" "$1"; fi
}

run "cd '$ROOT' && cur=\$(readlink current) \
  && prev=\$(ls -1d releases/* | sort | grep -B1 -x \"\$cur\" | head -n 1) \
  && if [ -z \"\$prev\" ] || [ \"\$prev\" = \"\$cur\" ]; then echo 'rollback: no earlier release' >&2; exit 1; fi \
  && ln -sfn \"\$prev\" current.tmp && mv -Tf current.tmp current && echo \"rollback: \$cur -> \$prev\""
