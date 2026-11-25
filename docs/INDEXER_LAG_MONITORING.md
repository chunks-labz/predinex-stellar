# Indexer Lag Monitoring

Issue #1686 gives operators a measurable signal when the event indexer falls behind the Stellar chain head.

## Metrics and endpoint

The API exposes admin-gated metrics at `GET /api/observability/metrics` in Prometheus text format:

| Metric | Meaning |
| --- | --- |
| `predinex_indexer_current_ledger_height` | Latest chain head from `getLatestLedger` on the RPC. |
| `predinex_indexer_indexed_ledger_height` | Latest ledger fully committed by the indexer. |
| `predinex_indexer_lag_ledgers` | `current - indexed`, clamped at zero. |
| `predinex_indexer_lag_threshold` | Alert threshold in ledgers. |
| `predinex_indexer_lag_alerting` | `1` while the lag alert is active. |

The same sample is available as JSON at `GET /api/observability/indexer-lag`, and every collection emits an `indexer_lag_metric` structured log line. Both routes require an `x-api-key` with the `Admin` role.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SOROBAN_RPC_URL` (or `RPC_URL`) | — | RPC endpoint used for `getLatestLedger`. |
| `INDEXER_STATUS_URL` | — | HTTP endpoint returning `{"indexedLedger": 12345}` (also accepts `indexed_ledger`, `lastProcessedLedger`, or `height`). |
| `INDEXER_LAG_THRESHOLD_LEDGERS` | `60` | Alert when lag reaches this many ledgers (~5 minutes at a 5s close time). |

When either height source is not configured, the gauges are omitted and no alert fires; configure both sources before relying on this signal.

## Alert

When lag reaches the threshold, the API logs one `indexer_lag_alert` error line with the affected heights, threshold, and runbook link. It does not repeat until the lag recovers below the threshold, so one sustained incident pages once.

```json
{
  "msg": "indexer_lag_alert",
  "alert": "indexer_lag",
  "currentLedgerHeight": 105000,
  "indexedLedgerHeight": 104930,
  "lagLedgers": 70,
  "threshold": 60,
  "runbook": "docs/INDEXER_LAG_MONITORING.md"
}
```

Alert from log aggregation on `msg = "indexer_lag_alert"` and `level = "error"`, or from Prometheus on `predinex_indexer_lag_ledgers >= predinex_indexer_lag_threshold`.

## Alert response

1. Acknowledge in `#predinex-oncall` and classify as SEV-2 using [the incident runbook](./INCIDENT_RUNBOOK.md#6-database-or-indexer-saturation).
2. Compare the chain head and indexed height from the alert; check whether the RPC itself is stalled before blaming the indexer.
3. Check connection pool usage, lock contention, and slow queries. Stop non-essential backfills and reduce indexer concurrency.
4. Inspect indexer logs around the alert timestamp for repeated RPC errors or reorg rollbacks. Only the database owner cancels a confirmed runaway query, and no production event table is deleted during triage.
5. Recover headroom, confirm the indexed height advances on two consecutive samples, then re-enable work gradually.
6. Record the saturation window and worst queries for the postmortem.

```bash
curl -fsS -H "x-api-key: $ADMIN_API_KEY" "$API_URL/api/observability/indexer-lag"
curl -fsS -H "x-api-key: $ADMIN_API_KEY" "$API_URL/api/observability/metrics"
soroban-rpc-client get_latest_ledger
psql "$DATABASE_URL" -c "SELECT MAX(indexed_ledger) FROM indexer_state;"
```
