#!/usr/bin/env bash
#
# Backup Restore Drill (#1688).
#
# Verifies that the latest database fixture backup can be restored into a clean
# database, validating schema structure and representative data rows.
#
# Static checks (--lint-only, no database required):
#   - verifies fixture file existence and readability;
#   - validates essential table DDL (migration_probe, indexer_state, pools, bets, claims);
#   - validates representative INSERT statements are present.
#
# Full drill against $DATABASE_URL:
#   1. connects to clean scratch database;
#   2. drops existing drill tables if present to ensure clean slate;
#   3. restores fixture SQL with ON_ERROR_STOP=1;
#   4. verifies table schema existence and required columns;
#   5. verifies representative rows and runbook queries:
#      - SELECT COUNT(*) FROM pools;
#      - SELECT MAX(indexed_ledger) FROM indexer_state;
#      - SELECT SUM(amount) FROM bets;
#      - status distribution and claim consistency.
#
# Usage:
#   DATABASE_URL=postgresql://... bash scripts/drill-backup-restore.sh
#   bash scripts/drill-backup-restore.sh --lint-only
#   bash scripts/drill-backup-restore.sh --fixture path/to/backup.sql
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_PATH="${REPO_ROOT}/db/fixtures/latest_backup.sql"
LINT_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lint-only)
      LINT_ONLY=true
      shift
      ;;
    --fixture)
      if [[ $# -lt 2 ]]; then
        echo "::error::--fixture requires a file path argument" >&2
        exit 2
      fi
      FIXTURE_PATH="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "::error::unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

fail() {
  echo "::error::$*" >&2
  exit 1
}

# ── Phase 1: Static checks on fixture ─────────────────────────────────────────

if [[ ! -f "$FIXTURE_PATH" ]]; then
  fail "Backup fixture file not found: $FIXTURE_PATH"
fi

if [[ ! -s "$FIXTURE_PATH" ]]; then
  fail "Backup fixture file is empty: $FIXTURE_PATH"
fi

REQUIRED_TABLES=("migration_probe" "indexer_state" "pools" "bets" "claims")

for table in "${REQUIRED_TABLES[@]}"; do
  if ! grep -Eiq "CREATE[[:space:]]+TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?${table}[[:space:]]*\(" "$FIXTURE_PATH"; then
    fail "Backup fixture missing table definition: $table"
  fi
  if ! grep -Eiq "INSERT[[:space:]]+INTO[[:space:]]+${table}" "$FIXTURE_PATH"; then
    fail "Backup fixture missing representative INSERT rows for table: $table"
  fi
done

echo "Static checks passed: fixture $(basename "$FIXTURE_PATH") contains DDL and representative data for all required tables (${REQUIRED_TABLES[*]})."

if [[ "$LINT_ONLY" = true ]]; then
  exit 0
fi

# ── Phase 2: Restore and verify against database ──────────────────────────────

: "${DATABASE_URL:?DATABASE_URL must point to the target database (or pass --lint-only)}"

if ! command -v psql >/dev/null 2>&1; then
  fail "psql command not found in PATH; required for database restore drill"
fi

echo "Connecting to target database..."
psql --quiet --set ON_ERROR_STOP=1 "$DATABASE_URL" -c "SELECT 1;" >/dev/null || fail "Unable to connect to target database via DATABASE_URL"

echo "Cleaning existing drill tables from scratch database..."
psql --quiet --set ON_ERROR_STOP=1 "$DATABASE_URL" << 'SQL'
DROP TABLE IF EXISTS claims CASCADE;
DROP TABLE IF EXISTS bets CASCADE;
DROP TABLE IF EXISTS pools CASCADE;
DROP TABLE IF EXISTS indexer_state CASCADE;
DROP TABLE IF EXISTS migration_probe CASCADE;
SQL

echo "Restoring backup fixture: $FIXTURE_PATH"
psql --quiet --set ON_ERROR_STOP=1 "$DATABASE_URL" -f "$FIXTURE_PATH" >/dev/null || fail "Failed to restore backup fixture into database"

echo "Verifying restored schema..."
for table in "${REQUIRED_TABLES[@]}"; do
  table_found=$(psql -At --set ON_ERROR_STOP=1 "$DATABASE_URL" -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='${table}';")
  if [[ "$table_found" -ne 1 ]]; then
    fail "Schema verification failed: table '${table}' does not exist after restore"
  fi
done

# Verify critical columns
psql -At --set ON_ERROR_STOP=1 "$DATABASE_URL" -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='indexer_state' AND column_name='indexed_ledger';" \
  | grep -q "indexed_ledger" || fail "indexer_state missing column indexed_ledger"

psql -At --set ON_ERROR_STOP=1 "$DATABASE_URL" -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='pools' AND column_name='status';" \
  | grep -q "status" || fail "pools missing column status"

echo "Verifying representative rows and runbook queries..."

# 1. Check migration probe
probe_count=$(psql -At --set ON_ERROR_STOP=1 "$DATABASE_URL" -c "SELECT count(*) FROM migration_probe;")
[[ "$probe_count" -ge 1 ]] || fail "Representative verification failed: migration_probe count is $probe_count (expected >= 1)"

# 2. Check indexer state and latest indexed ledger
max_ledger=$(psql -At --set ON_ERROR_STOP=1 "$DATABASE_URL" -c "SELECT COALESCE(MAX(indexed_ledger), 0) FROM indexer_state;")
[[ "$max_ledger" -gt 0 ]] || fail "Representative verification failed: MAX(indexed_ledger) is $max_ledger (expected > 0)"

# 3. Check pools count and statuses
pool_count=$(psql -At --set ON_ERROR_STOP=1 "$DATABASE_URL" -c "SELECT count(*) FROM pools;")
[[ "$pool_count" -ge 1 ]] || fail "Representative verification failed: pools count is $pool_count (expected >= 1)"

open_or_scheduled_pools=$(psql -At --set ON_ERROR_STOP=1 "$DATABASE_URL" -c \
  "SELECT count(*) FROM pools WHERE status IN ('Open', 'Scheduled');")
[[ "$open_or_scheduled_pools" -ge 1 ]] || fail "Representative verification failed: no Open/Scheduled pools found"

# 4. Check bets count and volume
bet_count=$(psql -At --set ON_ERROR_STOP=1 "$DATABASE_URL" -c "SELECT count(*) FROM bets;")
[[ "$bet_count" -ge 1 ]] || fail "Representative verification failed: bets count is $bet_count (expected >= 1)"

total_bet_volume=$(psql -At --set ON_ERROR_STOP=1 "$DATABASE_URL" -c "SELECT COALESCE(SUM(amount), 0) FROM bets;")
[[ "$total_bet_volume" -gt 0 ]] || fail "Representative verification failed: total bet volume is $total_bet_volume (expected > 0)"

# 5. Check claims count
claim_count=$(psql -At --set ON_ERROR_STOP=1 "$DATABASE_URL" -c "SELECT count(*) FROM claims;")
[[ "$claim_count" -ge 1 ]] || fail "Representative verification failed: claims count is $claim_count (expected >= 1)"

echo ""
echo "================ BACKUP RESTORE DRILL SUCCESS ================"
echo " Restored fixture:       $(basename "$FIXTURE_PATH")"
echo " Verified tables:        ${REQUIRED_TABLES[*]}"
echo " Total pools restored:   $pool_count"
echo " Total bets restored:    $bet_count (volume: $total_bet_volume stroops)"
echo " Total claims restored:  $claim_count"
echo " Latest indexed ledger:  $max_ledger"
echo "=============================================================="
exit 0
