# Database Migrations and the Rollback Dry Run

Database migrations live in `db/migrations/` as SQL pairs:

```
db/migrations/
  001_initial.up.sql     applies the change
  001_initial.down.sql   undoes it
```

Files are applied in lexical order, so keep the numeric prefix zero-padded
(`001_`, `002_`, …). Every `.up.sql` needs a `.down.sql` with the same name.

## The rollback dry run

`scripts/verify-migrations.sh` (#1505, #1663) proves every migration can be
applied and rolled back before it is used in production. CI runs it in the
**Migration Rollback Gate** job of `.github/workflows/ci.yml` against an empty
Postgres 16 service database, on every push and pull request.

**Static checks** (no database):

- every `.up.sql` has a matching `.down.sql`, and every `.down.sql` has its
  `.up.sql`;
- every `.down.sql` contains at least one SQL statement (comments and blank
  lines don't count);
- no migration file contains a line starting with `-- irreversible`.

**Database checks**, for each migration in order:

1. apply the up step and record the schema (`pg_dump --schema-only`);
2. apply the down step; the schema must match the one from before the up step;
3. apply the up step again; the schema must match step 1.

Finally every down step runs in reverse order, and the schema must match the
empty starting point.

The job fails on the first problem and names the migration, with a diff of the
schema when one is involved.

### Irreversible migrations

If a change genuinely cannot be undone (for example, it discards data), mark
the file:

```sql
-- irreversible: drops the legacy_scores column and its data
ALTER TABLE markets DROP COLUMN legacy_scores;
```

The gate then fails on purpose. Such a migration needs an explicit decision and
a rollback plan in the PR (for example, a backup-and-restore step in
[docs/deployments/rollback.md](./deployments/rollback.md)) before the marker is
removed and a real `.down.sql` is written.

## Running it locally

You need `psql` and `pg_dump` (any version at least as new as the server) and
Docker.

```bash
# 1. A throwaway Postgres matching CI.
docker run -d --rm --name predinex-migrations \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=predinex_ci \
  -p 127.0.0.1:55432:5432 postgres:16-alpine
until pg_isready -q -h 127.0.0.1 -p 55432; do sleep 1; done

# 2. Static checks only (no database needed).
bash scripts/verify-migrations.sh --lint-only

# 3. The full dry run.
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/predinex_ci \
  bash scripts/verify-migrations.sh

# 4. The gate's own tests (each creates and drops its own database).
PREDINEX_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres \
  python3 -m unittest scripts/tests/test_verify_migrations.py -v

# 5. Clean up.
docker stop predinex-migrations
```

Point `DATABASE_URL` only at a scratch database: the dry run creates and drops
the schema objects your migrations define. Set `MIGRATIONS_DIR` to check a
different directory.

Newer `pg_dump` releases (16.10+, 17.6+) add a random `\restrict` key to every
dump; the script removes those lines before comparing, so schema diffs only
show real differences.
