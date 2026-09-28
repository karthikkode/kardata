#!/bin/sh
# Migrate then serve. Fail closed: no server without a migrated database.
set -eu
node backend/dist/db/cli.js up
exec node backend/dist/server.js
