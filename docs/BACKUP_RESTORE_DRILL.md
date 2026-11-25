# Database Backup Restore Drill

This document describes the automated backup restore drill and verification procedures for Predinex (#1688).

---

## Overview & Acceptance Criteria

Regular verification of backup recovery ensures operational readiness and data integrity before deployments or disaster scenarios.

1. **Automated CI Job:** Restores the latest fixture backup (`db/fixtures/latest_backup.sql`) into a clean database.
2. **Schema & Representative Data Verification:** Validates critical tables (`migration_probe`, `indexer_state`, `pools`, `bets`, `claims`), column types, and representative operational records (indexed ledger cursor, active and settled pool distributions, bet volumes).
3. **Local Drill Procedures:** Documented instructions for engineers to execute the restore drill locally with Docker or existing PostgreSQL instances.

---

## Fixture Location

The primary backup fixture is located at:
`db/fixtures/latest_backup.sql`

It contains DDL definitions and representative records reflecting:
- `migration_probe`: baseline migration marker.
- `indexer_state`: event indexer cursor and `indexed_ledger` watermark.
- `pools`: open, scheduled, and settled prediction market pools.
- `bets`: user wagers across multiple outcomes and amounts.
- `claims`: claimed payouts with fee accounting.

---

## Running the Drill Locally

### 1. Static Linting (No Database Required)

You can validate the structure and presence of required DDL and INSERT data without a database:

```bash
bash scripts/drill-backup-restore.sh --lint-only
```

Or pass a custom fixture:

```bash
bash scripts/drill-backup-restore.sh --lint-only --fixture path/to/backup.sql
```

### 2. Full Restore Drill with Docker

Start a clean PostgreSQL container:

```bash
docker run --name predinex-drill-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=predinex_drill \
  -p 5432:5432 -d postgres:16
```

Execute the restore drill:

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/predinex_drill"
bash scripts/drill-backup-restore.sh
```

Clean up the Docker container when finished:

```bash
docker rm -f predinex-drill-db
```

### 3. Running Against an Existing PostgreSQL Instance

Set `DATABASE_URL` pointing to a scratch database and execute:

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/scratch_db" \
  bash scripts/drill-backup-restore.sh
```

The script cleans up existing drill tables before restoring.

### 4. Running the Test Suite

Unit and integration tests for the drill script:

```bash
# Static checks:
python3 -m unittest scripts/tests/test_backup_restore_drill.py -v

# Full integration checks (with a test PostgreSQL instance):
PREDINEX_TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" \
  python3 -m unittest scripts/tests/test_backup_restore_drill.py -v
```

---

## What the Drill Verifies

During Phase 2, `scripts/drill-backup-restore.sh` executes the following checks:

1. **Table Schema Existence:**
   - `migration_probe`
   - `indexer_state`
   - `pools`
   - `bets`
   - `claims`
2. **Column Integrities:**
   - `indexer_state.indexed_ledger`
   - `pools.status`
3. **Operational Assertions:**
   - `SELECT COUNT(*) FROM migration_probe` $\ge 1$
   - `SELECT MAX(indexed_ledger) FROM indexer_state` $> 0$
   - `SELECT COUNT(*) FROM pools` $\ge 1$
   - `SELECT COUNT(*) FROM pools WHERE status IN ('Open', 'Scheduled')` $\ge 1$
   - `SELECT SUM(amount) FROM bets` $> 0$
   - `SELECT COUNT(*) FROM claims` $\ge 1$

---

## CI Gate

The GitHub Actions workflow `.github/workflows/ci.yml` runs the `backup-restore-drill` job on every pull request and push to `main` using a `postgres:16` service container.
