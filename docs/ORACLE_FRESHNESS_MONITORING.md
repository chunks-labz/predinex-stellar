# Oracle Feed Freshness Monitoring

Issue #1687 alerts when a market keeps trading with prices that have not refreshed within the expected window.

## Feed identity

A feed is the canonical identifier used in alert metadata and metrics:

- `pool:<id>` for on-chain TWAP/oracle feeds (a bare numeric id is normalized to this form).
- `pair:<symbol>` for off-chain price feeds, e.g. `pair:XLM/USDC`.

The API tracks `lastSuccessfulUpdateAt` per feed in memory. Event consumers call `POST /api/observability/oracle-feeds` with `{"feed": "pool:10", "updatedAt": 1763932800}` after a successful `twap_updated` event or price update. `updatedAt` is a Unix timestamp in seconds and defaults to the server clock when omitted. State is per process; restart rebuilds it from the next successful updates.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ORACLE_FEED_FRESHNESS_THRESHOLD_SECS` | `900` | Alert once a feed has no successful update for this many seconds. |

The admin-gated state endpoint is `GET /api/observability/oracle-feeds`. It evaluates every tracked feed and returns its last successful update, age, and staleness.

## Metrics and alert

`GET /api/observability/metrics` exposes `predinex_oracle_feed_last_update_timestamp_seconds{feed="..."}`, `predinex_oracle_feed_age_seconds{feed="..."}`, `predinex_oracle_feed_stale{feed="..."}`, and `predinex_oracle_feed_freshness_threshold_seconds`.

A stale feed logs one `stale_oracle_feed_alert` error line. The affected feed is always included in the metadata so the alert is actionable when many feeds are tracked; it does not repeat until that feed is fresh again.

```json
{
  "msg": "stale_oracle_feed_alert",
  "alert": "stale_oracle_feed",
  "feed": "pool:10",
  "lastSuccessfulUpdateAt": "2026-11-24T11:00:00.000Z",
  "ageSeconds": 960,
  "freshnessThresholdSecs": 900,
  "runbook": "docs/ORACLE_FRESHNESS_MONITORING.md"
}
```

Alert from log aggregation on `msg = "stale_oracle_feed_alert"` and group by `feed`, or from Prometheus on `predinex_oracle_feed_stale == 1`.

## Alert response

1. Acknowledge in `#predinex-oncall` and classify as SEV-2 using [the stale oracle playbook](./INCIDENT_RUNBOOK.md#8-stale-oracle-or-twap). The `feed` field is the first thing to record in the incident timeline.
2. Check the feed's age and last successful update at `GET /api/observability/oracle-feeds`, then compare with `get_stale_oracle_threshold()` for pool feeds.
3. Check the updater/bot logs and `upstreamTimeouts`; an unavailable provider or stopped `update_twap` job is the common cause.
4. Pause auto-settlement if outcomes or transaction status are ambiguous. Do not substitute an unverified winning outcome.
5. Resume after a fresh, verified price update and a successful read-only contract call. For credential changes, follow [oracle key rotation](./ORACLE_ROTATION.md) exactly.

```bash
curl -fsS -H "x-api-key: $ADMIN_API_KEY" "$API_URL/api/observability/oracle-feeds"
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_stale_oracle_threshold
curl -fsS "$BOT_HEALTH_URL/health/metrics"
soroban-rpc-client get_events --contract-id "$CONTRACT_ID" --limit 100
```
