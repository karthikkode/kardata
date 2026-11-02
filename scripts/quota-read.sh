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
curl --fail-with-body -sS -m 20 -X POST https://api.meta.ai/muse-code/key \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{}' | python3 "$(dirname "$0")/quota-response.py" || {
  echo "quota-read: bad or empty quota response" >&2
  exit 1
}
unset TOKEN
