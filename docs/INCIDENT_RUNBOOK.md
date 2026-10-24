# Production Incident Runbook

Use this page during an active incident. The incident commander owns the timeline and delegates technical work; responders should record commands, timestamps, and decisions in the incident channel.

## Severity and escalation

| Severity | Definition | Escalation |
| --- | --- | --- |
| SEV-1 | Funds at risk, settlement integrity failure, or broad user outage | Page incident commander, protocol lead, and on-call engineer immediately; update every 15 minutes |
| SEV-2 | A major upstream or subsystem is degraded, but funds remain safe | Page on-call engineer and service owner; update every 30 minutes |
| SEV-3 | Localized degradation or non-critical operational failure | Create an incident ticket and notify the service owner during business hours |

On-call contacts: `#predinex-oncall` (primary), `#predinex-incidents` (incident coordination), and the current rotation in the team pager. If no responder acknowledges within 10 minutes, escalate to the protocol lead and engineering manager.

## First five minutes

1. Declare the severity and incident commander in `#predinex-incidents`.
2. Freeze risky deployments and preserve logs, metrics, and the latest ledger/indexer heights.
3. Check RPC timeout counts, settlement lag, database saturation, and error rates.
4. Prefer read-only diagnostics. Pause automated settlement if correctness is uncertain.
5. Communicate user impact, current mitigation, and next update time.

## Playbooks

### Settlement stuck

1. Confirm expired pools and compare the bot's pending pool count with on-chain state.
2. Check bot logs and `upstreamTimeouts` for RPC/oracle failures; do not blindly retry a submitted transaction.
3. Verify the pool is still unsettled and the winning outcome is authoritative.
4. Pause auto-settlement if outcomes or transaction status are ambiguous; otherwise retry one bounded batch.
5. Recheck transaction finality and settlement lag, then document any pools requiring manual settlement.

### RPC outage

1. Confirm the failure from the readiness endpoint and a second RPC health check.
2. Compare upstream timeout metrics by origin and inspect the provider status page.
3. Disable writes and automated settlement while RPC responses are unavailable.
4. Fail over to the approved RPC endpoint, keeping the configured timeout and retry limits.
5. Resume writes only after ledger height advances and a read-only contract call succeeds.

### Database saturation

1. Check connection pool usage, CPU, memory, disk, locks, and slow queries.
2. Stop non-essential backfills and reduce indexer concurrency; never delete production data during triage.
3. Identify and cancel only confirmed runaway queries with the database owner present.
4. Restore headroom, validate indexer lag and error rates, then re-enable work gradually.
5. Capture the worst queries and saturation window for follow-up capacity work.

## Closure

The incident commander confirms recovery, records customer impact and timeline, assigns a root-cause owner, and schedules a blameless postmortem within five business days.
