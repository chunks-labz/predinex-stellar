# Indexer cursor backup and restore

The indexer cursor is the durable checkpoint for the last ledger/event range
processed. Backing it up allows recovery after disk loss or migration to another
host without replaying an unbounded history.

## What to back up

Back up the cursor value, last fully committed ledger, contract/network scope,
schema or migration version, creation time, and a checksum of the serialized
cursor file. Never back up credentials, private keys, or an in-flight cursor.

## Procedure

1. Stop the indexer gracefully, or pause ingestion while a batch is in flight.
2. Copy the configured cursor file/database to encrypted backup storage.
3. Write a sidecar manifest with scope, schema version, checksum, and source SHA.
4. Restore into a temporary directory and verify the cursor before relying on it.
5. Restart and confirm the first resumed ledger is `last_processed_ledger + 1`.
6. Compare resumed events with the database's unique event count; replay must be idempotent.

~~~bash
set -eu
CURSOR_FILE="`{INDEXER_CURSOR_FILE:?set INDEXER_CURSOR_FILE}`"
BACKUP_DIR="`{INDEXER_BACKUP_DIR:?set INDEXER_BACKUP_DIR}`"
STAMP="`(date -u +%Y%m%dT%H%M%SZ)`"
mkdir -p "`{BACKUP_DIR}`"
sha256sum "`{CURSOR_FILE}`" > "`{BACKUP_DIR}`/cursor-`{STAMP}`.sha256"
cp --preserve=mode,timestamps "`{CURSOR_FILE}`" "`{BACKUP_DIR}`/cursor-`{STAMP}`.db"
~~~

Keep at least three known-good generations, encrypt backups at rest, and test a
restore after every cursor schema migration. Alert when backup age exceeds the
ingestion SLA or when the cursor moves backwards.
