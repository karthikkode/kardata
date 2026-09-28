#!/bin/sh
# Turn/sweep worker. No migrate here: the backend entrypoint owns
# migrations, this service starts after it. Fail closed: no worker
# without Temporal and a database.
set -eu
exec node backend/dist/temporal/dev-worker.js
