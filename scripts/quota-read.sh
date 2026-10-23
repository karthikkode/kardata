#!/usr/bin/env bash
# Read the app account's live subscription quota (5h + weekly %) from the
# key-mint endpoint, using the app login in the kardata_muse volume.
# Prints usage fields ONLY as JSON on stdout; the token and the rest of the
# response never leave this script. Exits nonzero (one stderr line) on any
# failure so callers keep their last snapshot.
set -euo pipefail

TOKEN="$(docker run --rm --network none -v kardata_muse:/opt/muse:ro --user agent --entrypoint /bin/bash kardata-agent -c "python3 -c \"import json;print(json.load(open('/opt/muse/home/.config/muse/auth.json'))['providers']['meta']['access_token'])\"")" || {
  echo "quota-read: cannot read app token" >&2
  exit 1
}
if [ -z "${TOKEN}" ]; then
  echo "quota-read: empty app token" >&2
  exit 1
fi
curl -s -m 20 -X POST https://api.meta.ai/muse-code/key \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{}' | python3 -c "
import datetime, json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(2)
u = d.get('subs_usage') or {}
if not isinstance(u, dict):
    sys.exit(3)
def pct(w):
    v = (w or {}).get('used_percent')
    return v if isinstance(v, int) and 0 <= v <= 100 else None
def reset(w):
    v = (w or {}).get('resets_at')
    if isinstance(v, int) and v > 0:
        try:
            return datetime.datetime.fromtimestamp(v, datetime.timezone.utc).isoformat()
        except Exception:
            return None
    return None
w = u.get('window')
k = u.get('weekly')
out = {'fivePct': pct(w), 'fiveResetAt': reset(w), 'weeklyPct': pct(k), 'weeklyResetAt': reset(k)}
if out['fivePct'] is None and out['weeklyPct'] is None:
    sys.exit(4)
print(json.dumps(out))
" || {
  echo "quota-read: bad or empty quota response" >&2
  exit 1
}
unset TOKEN
