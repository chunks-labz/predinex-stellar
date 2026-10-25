#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point at the scratch database}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-db/migrations}"
before="$(mktemp)"
after="$(mktemp)"
trap 'rm -f "$before" "$after"' EXIT

pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL" > "$before"
for migration in "$MIGRATIONS_DIR"/*.up.sql; do
  [ -e "$migration" ] || continue
  psql --set ON_ERROR_STOP=1 "$DATABASE_URL" -f "$migration"
done
for migration in $(find "$MIGRATIONS_DIR" -name '*.down.sql' -print | sort -r); do
  psql --set ON_ERROR_STOP=1 "$DATABASE_URL" -f "$migration"
done
pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL" > "$after"
diff -u "$before" "$after"
