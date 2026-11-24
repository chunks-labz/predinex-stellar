# Production Incident Runbook

Use this page during an active incident. The incident commander owns the timeline and delegates technical work; responders should record commands, timestamps, and decisions in the incident channel. All commands below are read-only unless a step explicitly says otherwise.

For task-specific detail, see the [paused-contract runbook](./PAUSED_CONTRACT_RUNBOOK.md), [oracle rotation procedure](./ORACLE_ROTATION.md), [deployment runbook](./DEPLOYMENT_RUNBOOK.md), and [ops tools](./OPS_TOOLS.md).

Set these shell variables once, replacing the placeholders with values from the environment reference in the relevant service's `.env.example`:

```bash
export CONTRACT_ID=C...                              # deployed predinex contract
export NETWORK=mainnet                               # or testnet
export RPC_URL=https://soroban-mainnet.stellar.org   # approved RPC endpoint
export API_URL=https://api.predinex.app              # API base URL
export BOT_HEALTH_URL=http://localhost:3000          # bot health server
```

> **Never paste secret keys into the incident channel.** Record that a key was used/rotated, not the key itself.

---

## 1. Severity and escalation

| Severity | Definition | Escalation |
| --- | --- | --- |
| SEV-1 | Funds at risk, settlement integrity failure, or broad user outage | Page incident commander, protocol lead, and on-call engineer immediately; update every 15 minutes |
| SEV-2 | A major upstream or subsystem is degraded, but funds remain safe | Page on-call engineer and service owner; update every 30 minutes |
| SEV-3 | Localized degradation or non-critical operational failure | Create an incident ticket and notify the service owner during business hours |

On-call contacts: `#predinex-oncall` (primary), `#predinex-incidents` (incident coordination), and the current rotation in the team pager. If no responder acknowledges within 10 minutes, escalate to the protocol lead and engineering manager.

### Route the signal to a playbook

| Signal | Start here | Default severity |
| --- | --- | --- |
| `ContractPaused` (50), unexpected `contract_paused` event | [Contract paused unexpectedly](#7-contract-paused-unexpectedly) | SEV-1 |
| Unknown admin/treasury caller, suspicious settlement | [Suspected key compromise or exploit](#9-suspected-key-compromise-or-exploit) | SEV-1 |
| Expired pools unsettled, growing settlement lag | [Settlement stalled or incorrect](#3-settlement-stalled-or-incorrect) | SEV-1 if outcomes are wrong, otherwise SEV-2 |
| RPC 5xx/timeouts, ledger height not advancing | [RPC degraded or unavailable](#4-rpc-degraded-or-unavailable) | SEV-2 |
| API 503s, frontend cannot load market data | [API or frontend unavailable](#5-api-or-frontend-unavailable) | SEV-2 |
| Connection pool exhaustion, slow queries, indexer lag | [Database or indexer saturation](#6-database-or-indexer-saturation) | SEV-2 |
| Stale oracle/TWAP, settlement rejected as stale | [Stale oracle or TWAP](#8-stale-oracle-or-twap) | SEV-2 |
| Failure immediately after a release | [Bad deployment or rollback needed](#10-bad-deployment-or-rollback-needed) | SEV-2 |
| `market_creation_failure_alert` log, repeated failed `create_market` submissions | [Failed Market Creation Monitoring](./MARKET_CREATION_MONITORING.md#triage) | SEV-3, SEV-2 if every creation fails |
| `fee_accumulator_growth_alert` log, rapid treasury fee growth | [Fee Accumulator Growth Monitoring](./FEE_ACCUMULATOR_MONITORING.md#triage) | SEV-3, SEV-2 if sustained or unexplained |

---

## 2. First five minutes

1. Declare the severity and incident commander in `#predinex-incidents`.
2. Freeze risky deployments and preserve logs, metrics, and the latest ledger/indexer heights.
3. Check RPC timeout counts, settlement lag, database saturation, and error rates.
4. Prefer read-only diagnostics. Pause automated settlement if correctness is uncertain.
5. Communicate user impact, current mitigation, and next update time.

### Capture shared evidence

Run these before changing state so the timeline is reproducible:

```bash
date -u '+%Y-%m-%dT%H:%M:%SZ'
git rev-parse HEAD                                   # deployed commit, if known

# Contract state
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- is_paused
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_admin
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_treasury_recipient
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_pool_count

# Recent contract activity
soroban-rpc-client get_events --contract-id "$CONTRACT_ID" --limit 100

# Service health
curl -fsS "$API_URL/healthz"
curl -fsS "$API_URL/readyz"
curl -fsS "$API_URL/health"
curl -fsS "$BOT_HEALTH_URL/health/metrics"
```

`/readyz` returns HTTP 503 with a `checks` map when configuration is missing. `/health` returns `200` only when all configured dependencies are healthy. A `/healthz` failure means the process is down; a `/readyz` or `/health` failure means it is up but should not receive traffic.

Record these in the incident channel with timestamps:

- [ ] Severity, incident commander, and service owner
- [ ] Deployed commit, contract ID, and network
- [ ] Latest ledger/indexer height and settlement lag
- [ ] First observed time, affected pools/users, and user-facing error codes
- [ ] Commands run and their output; mitigation decisions and who approved them

---

## 3. Settlement stalled or incorrect

1. Confirm expired pools and compare the bot's pending pool count with on-chain state.
2. Check bot logs and `upstreamTimeouts` for RPC/oracle failures; do not blindly retry a submitted transaction.
3. Verify the pool is still unsettled and the winning outcome is authoritative.
4. Pause auto-settlement if outcomes or transaction status are ambiguous; otherwise retry one bounded batch.
5. Recheck transaction finality and settlement lag, then document any pools requiring manual settlement.

```bash
# Bot liveness, readiness, and settlement telemetry
curl -fsS "$BOT_HEALTH_URL/healthz"
curl -fsS "$BOT_HEALTH_URL/readyz"
curl -fsS "$BOT_HEALTH_URL/health/metrics"

# Print example: { "running": true, "cycleCount": ..., "lastSettlementAt": "...",
#                  "pendingPoolsCount": ..., "errorCount": ...,
#                  "upstreamTimeouts": { ... } }

# Find expired pools still awaiting work, and watch them over time
./scripts/monitor-stuck-markets.sh --contract-id "$CONTRACT_ID"

# Confirm a specific pool is still unsettled before any retry
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_pool POOL_ID
```

**Stop conditions:** stop and escalate if the winning outcome is disputed, if the last transaction is still pending, or if `upstreamTimeouts` is climbing. Never submit a second settlement for a pool whose transaction status is unknown. For state-transition rules and manual settlement, use [MARKET_LIFECYCLE.md](./MARKET_LIFECYCLE.md) and [CLAIM_LIFECYCLE.md](./CLAIM_LIFECYCLE.md).

---

## 4. RPC degraded or unavailable

1. Confirm the failure from the readiness endpoint and a second RPC health check.
2. Compare upstream timeout metrics by origin and inspect the provider status page.
3. Disable writes and automated settlement while RPC responses are unavailable.
4. Fail over to the approved RPC endpoint, keeping the configured timeout and retry limits.
5. Resume writes only after ledger height advances and a read-only contract call succeeds.

```bash
# Health from this host and from a second network path
curl -fsS "$RPC_URL/health"
soroban-rpc-client health-check

# Ledger height must advance between two samples
soroban-rpc-client get_latest_ledger
sleep 10
soroban-rpc-client get_latest_ledger

# Read-only contract call after failover
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_pool_count
```

An RPC failure is not a reason to retry writes: a transaction may have been accepted even if the response was lost. Confirm on-chain state first. The mainnet RPC key is configured in [`deploy-mainnet.yml`](../.github/workflows/deploy-mainnet.yml) — rotate it only through the provider, never by pasting it into a chat.

---

## 5. API or frontend unavailable

1. Check liveness first, then readiness and dependency health, to distinguish a crashed process from a degraded one.
2. Compare API error rate and latency with the last deploy; check whether `/readyz` reports a missing required setting.
3. Confirm the RPC and any configured health probe URLs; review [COMPLIANCE_API_SECURITY.md](./COMPLIANCE_API_SECURITY.md) if authentication errors spiked.
4. For a build/config regression, follow [rollback.md](./deployments/rollback.md) and redeploy the last known-good artifact.
5. Post a user-facing status update and confirm market data loads again before closing.

```bash
# Liveness (process up?), readiness (can serve traffic?), dependency health
curl -i "$API_URL/healthz"
curl -i "$API_URL/readyz"
curl -i "$API_URL/health"

# A degraded dependency example from /health:
# { "status": "degraded",
#   "dependencies": { "database": { "status": "healthy" },
#                     "rpc": { "status": "degraded", "detail": "rpc returned HTTP 503" },
#                     "queue": { "status": "healthy", "detail": "not configured" } },
#   "cachedAt": "2026-11-20T12:00:00.000Z" }

# OpenAPI document should still be served by the deployed API
curl -fsS "$API_URL/api/openapi.json" -o /dev/null -w '%{http_code}\n'
```

If `/healthz` fails, restart or replace the process. If only `/readyz` or `/health` fails, keep the process up but stop routing traffic to it until dependencies recover. Do not change `AUTH_SECRET` during triage: invalidating it logs every client out and requires coordinated redeploy.

---

## 6. Database or indexer saturation

1. Check connection pool usage, CPU, memory, disk, locks, and slow queries.
2. Stop non-essential backfills and reduce indexer concurrency; never delete production data during triage.
3. Identify and cancel only confirmed runaway queries with the database owner present.
4. Restore headroom, validate indexer lag and error rates, then re-enable work gradually.
5. Capture the worst queries and saturation window for follow-up capacity work.

```bash
# Connections by state; long-running queries first
psql "$DATABASE_URL" -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"
psql "$DATABASE_URL" -c "SELECT pid, now() - query_start AS duration, state, left(query, 100) AS query FROM pg_stat_activity WHERE state <> 'idle' ORDER BY duration DESC LIMIT 20;"

# Blocked queries, if lock contention is suspected
psql "$DATABASE_URL" -c "SELECT pid, wait_event_type, wait_event, left(query, 100) AS query FROM pg_stat_activity WHERE wait_event_type = 'Lock';"

# Indexer health, then API dependency view
curl -fsS "$API_URL/health"
```

Only the database owner cancels a confirmed runaway query (`SELECT pg_cancel_backend(pid);`), and only after recording the PID and query. Never run `DELETE` against production event tables during an incident. Capture the saturation window and query text for the postmortem.

---

## 7. Contract paused unexpectedly

1. Confirm with `is_paused` and identify the caller from the most recent `contract_paused` event.
2. Compare the caller with `get_admin` and `get_treasury_recipient` and check for an announced maintenance action.
3. If the pause is authorized, continue in the [paused-contract runbook](./PAUSED_CONTRACT_RUNBOOK.md) for caller impact and unpause authorization.
4. If it is not authorized, treat it as a key compromise: go to [Suspected key compromise or exploit](#9-suspected-key-compromise-or-exploit) and do not unpause until the key is contained.
5. Post the user-facing banner from the paused-contract runbook while you decide.

```bash
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- is_paused
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_admin
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_treasury_recipient
soroban-rpc-client get_events --contract-id "$CONTRACT_ID" --limit 100
```

A single frozen pool is **not** a contract pause: it returns `PoolIsFrozen` (16), not `ContractPaused` (50). See [MARKET_LIFECYCLE.md](./MARKET_LIFECYCLE.md) for that case.

---

## 8. Stale oracle or TWAP

1. Compare `get_stale_oracle_threshold()` with the age of the affected pools' price updates.
2. Check bot oracle logs and `upstreamTimeouts`; an unavailable oracle provider is a SEV-2 until outcomes are affected.
3. Confirm whether `update_twap` is running: a stopped updater can make otherwise valid settlements fail as stale.
4. For a credential change, follow the [oracle rotation procedure](./ORACLE_ROTATION.md) exactly, including the two-step `propose_admin` / `accept_admin` flow.
5. Resume settlement only after a fresh price update and a successful read-only contract call.

```bash
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_stale_oracle_threshold
curl -fsS "$BOT_HEALTH_URL/health/metrics"
soroban-rpc-client get_events --contract-id "$CONTRACT_ID" --limit 100
```

Never substitute an unverified winning outcome to unblock settlement. If outcomes are genuinely ambiguous, pause auto-settlement and escalate to the protocol lead.

---

## 9. Suspected key compromise or exploit

1. Declare SEV-1 and notify the protocol lead and security owner through the private channel in [SECURITY.md](../SECURITY.md).
2. Preserve evidence before rotating or pausing: events, transaction hashes, caller addresses, and the affected time window.
3. Contain with the minimum reversible action: pause automated settlement, then use the [paused-contract runbook](./PAUSED_CONTRACT_RUNBOOK.md) if the contract itself must be paused.
4. Rotate the affected credential with the [oracle rotation procedure](./ORACLE_ROTATION.md); do not reuse a key that may have been exposed.
5. Coordinate user communication and any advisory through the incident commander. Do not discuss unpatched exploit details in public channels.

```bash
# Evidence only — read-only
date -u '+%Y-%m-%dT%H:%M:%SZ'
soroban-rpc-client get_events --contract-id "$CONTRACT_ID" --limit 100
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_admin
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_treasury_recipient
```

Treat an unauthorized `set_paused`, `set_admin`, or mass settlement as a key-compromise signal. Funds safety takes priority over availability: keep the contract paused until the rotation and verification checklist is complete.

---

## 10. Bad deployment or rollback needed

1. Stop further deployments and identify the first failing check (health probe, smoke test, or error-rate spike).
2. Confirm the last known-good commit and contract ID from the deployment manifest or release record.
3. Follow [rollback.md](./deployments/rollback.md) and the [deployment runbook](./DEPLOYMENT_RUNBOOK.md) for the target environment.
4. Re-run `scripts/check-deployment-health.py --url "$DEPLOYMENT_URL"` before posting a recovery update.
5. Record why the release gate did not catch the problem.

```bash
# What is currently deployed and healthy?
git rev-parse HEAD
curl -fsS "$API_URL/healthz" -o /dev/null -w '%{http_code}\n'
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_pool_count
```

Soroban contract upgrades are immutable: a rollback deploys a new contract and requires updating the configured `NEXT_PUBLIC_SOROBAN_CONTRACT_ID` (see [`web/.env.example`](../web/.env.example)). Coordinate the contract and web deployment so users are never pointed at a mismatched pair.

---

## 11. Closure

The incident commander confirms recovery, records customer impact and timeline, assigns a root-cause owner, and schedules a blameless postmortem within five business days.

Before closing:

- [ ] Recovery signal is confirmed (health probes green, settlement lag normal, ledger/indexer height advancing).
- [ ] User-facing status is cleared and affected users/pools are listed.
- [ ] Evidence, commands, decisions, and timestamps are attached to the incident ticket.
- [ ] Temporary mitigations (pauses, disabled automation, failovers) are either reversed or tracked with an owner.
- [ ] Follow-up actions have owners and due dates; link the postmortem here once published.
