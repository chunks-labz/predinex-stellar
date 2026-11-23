#!/usr/bin/env bash
#
# Migration rollback dry run (#1505, #1663).
#
# Proves every migration in db/migrations can be applied and rolled back
# against a clean scratch database before it is used in production.
#
# Phase 1, static checks (no database needed):
#   - every NNN_name.up.sql has a matching NNN_name.down.sql, and no .down.sql
#     is left without its .up.sql;
#   - every down file contains at least one SQL statement;
#   - no migration file contains an `-- irreversible` marker. A migration
#     that cannot be undone must say so with that marker, and this gate then
#     refuses it until it is given a real rollback.
#
# Phase 2, against $DATABASE_URL (skipped with --lint-only), for each
# migration in order:
#   1. apply its up step, and record the schema;
#   2. apply its down step: the schema must match the one before the up step;
#   3. apply the up step again: the schema must match step 1, proving the
#      down step left nothing behind that blocks a re-run.
# Finally every down step runs in reverse order and the schema must match
# the starting point, as the original gate checked.
#
# Usage:
#   DATABASE_URL=postgresql://... bash scripts/verify-migrations.sh
#   bash scripts/verify-migrations.sh --lint-only
#
# See docs/MIGRATIONS.md for running it locally against a throwaway Postgres.
set -euo pipefail

MIGRATIONS_DIR="${MIGRATIONS_DIR:-db/migrations}"
LINT_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --lint-only) LINT_ONLY=true ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

fail() {
  echo "::error::$*" >&2
  exit 1
}

[ -d "$MIGRATIONS_DIR" ] || fail "migrations directory not found: $MIGRATIONS_DIR"

# ── Phase 1: static checks ────────────────────────────────────────────────────

problems=()
ups=()
while IFS= read -r -d '' up; do
  ups+=("$up")
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.up.sql' -print0 | sort -z)

# True when a file has at least one non-comment, non-blank line.
has_sql() {
  grep -Ev '^[[:space:]]*(--.*)?$' "$1" >/dev/null 2>&1
}

for up in "${ups[@]}"; do
  down="${up%.up.sql}.down.sql"
  name="$(basename "${up%.up.sql}")"
  if [ ! -f "$down" ]; then
    problems+=("$name: missing rollback file $(basename "$down")")
  elif ! has_sql "$down"; then
    problems+=("$name: rollback file $(basename "$down") has no SQL statements")
  fi
  for file in "$up" "$down"; do
    if [ -f "$file" ] && grep -Eiq '^[[:space:]]*--[[:space:]]*irreversible' "$file"; then
      problems+=("$name: $(basename "$file") is marked irreversible")
    fi
  done
done

while IFS= read -r -d '' down; do
  up="${down%.down.sql}.up.sql"
  if [ ! -f "$up" ]; then
    problems+=("$(basename "${down%.down.sql}"): rollback file has no matching $(basename "$up")")
  fi
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.down.sql' -print0 | sort -z)

if [ "${#problems[@]}" -gt 0 ]; then
  for problem in "${problems[@]}"; do
    echo "::error::$problem" >&2
  done
  exit 1
fi

echo "static checks passed for ${#ups[@]} migration(s) in $MIGRATIONS_DIR"

if [ "$LINT_ONLY" = true ]; then
  exit 0
fi

# ── Phase 2: apply and roll back against a scratch database ───────────────────

: "${DATABASE_URL:?DATABASE_URL must point at the scratch database (or pass --lint-only)}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

snapshot() {
  # pg_dump 16.10+/17.6+ wraps every dump in `\restrict <random key>` lines
  # (CVE-2025-8714); drop them so identical schemas compare equal.
  pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL" \
    | sed -E '/^\\(un)?restrict /d' > "$1"
}

run_sql() {
  psql --quiet --set ON_ERROR_STOP=1 "$DATABASE_URL" -f "$1" > /dev/null
}

expect_same() {
  local expected="$1" actual="$2" message="$3"
  if ! diff -u "$expected" "$actual" > "$workdir/diff"; then
    cat "$workdir/diff" >&2
    fail "$message"
  fi
}

snapshot "$workdir/start.sql"
cp "$workdir/start.sql" "$workdir/before.sql"

for up in "${ups[@]}"; do
  name="$(basename "${up%.up.sql}")"
  down="${up%.up.sql}.down.sql"

  run_sql "$up" || fail "$name: up step failed"
  snapshot "$workdir/up.sql"

  run_sql "$down" || fail "$name: down step failed"
  snapshot "$workdir/down.sql"
  expect_same "$workdir/before.sql" "$workdir/down.sql" \
    "$name: rolling back did not restore the schema it started from"

  run_sql "$up" || fail "$name: up step failed when re-applied after its rollback"
  snapshot "$workdir/reup.sql"
  expect_same "$workdir/up.sql" "$workdir/reup.sql" \
    "$name: re-applying after a rollback produced a different schema"

  echo "ok  $name: up, down and re-up"
  cp "$workdir/up.sql" "$workdir/before.sql"
done

for (( i=${#ups[@]}-1; i>=0; i-- )); do
  up="${ups[$i]}"
  run_sql "${up%.up.sql}.down.sql" || fail "$(basename "${up%.up.sql}"): down step failed during full rollback"
done
snapshot "$workdir/end.sql"
expect_same "$workdir/start.sql" "$workdir/end.sql" \
  "rolling back every migration did not return to the starting schema"

echo "rollback dry run passed for ${#ups[@]} migration(s)"
