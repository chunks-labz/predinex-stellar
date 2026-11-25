# Fee Accumulator Growth Monitoring

`scripts/check-fee-accumulator-growth.py` pages operators when the treasury fee
accumulator grows faster than expected over a fixed window (#1666). It is a
standalone Python 3 script with no third-party dependencies: contract reads use
`simulateTransaction` over plain HTTP, and the small ScVal/XDR subset it needs
is decoded in the script itself.

## What is measured

The script sums `get_pool_protocol_revenue(pool_id).treasury_credited` for every
pool ID from 1 through `get_pool_count()`. This value is cumulative and
monotonic: it includes protocol fees already credited to the treasury, payout
dust, and pending multi-asset fees awaiting `collect_multi_asset_fees`. See
[FEE_SCHEDULE.md](./FEE_SCHEDULE.md) for where each fee comes from.

If that view is unavailable, the script falls back to `get_treasury_balance`.
The fallback is a **net** balance: treasury withdrawals reduce it, so a
withdrawal can hide growth or produce a negative delta. Treat a fallback alert
as authoritative but a fallback *absence* of alerts as inconclusive. The alert
record's `source` field states which path produced the reading.

## Formula and defaults

For each network/contract pair, the oldest sample still inside the window is
the baseline and the newest sample is the current value:

```
delta   = currentStroops - baselineStroops
limit   = max(baselineStroops * thresholdPct / 100, minDeltaStroops)
alert   = delta > limit
```

| Variable | CLI flag | Default |
| --- | --- | --- |
| `FEE_GROWTH_WINDOW_SECONDS` | `--window-seconds` | `900` (15 minutes) |
| `FEE_GROWTH_THRESHOLD_PCT` | `--threshold-pct` | `25` (25% per window) |
| `FEE_GROWTH_MIN_DELTA_STROOPS` | `--min-delta-stroops` | `1000000000` (100 XLM) |
| `FEE_GROWTH_INTERVAL_SECONDS` | `--interval-seconds` | `60` |
| `FEE_GROWTH_RPC_TIMEOUT_SECONDS` | `--timeout-seconds` | `10` |
| `FEE_GROWTH_STATE_FILE` | `--state-file` | `monitoring-logs/fee-accumulator-samples.ndjson` |
| `FEE_GROWTH_CONTRACT_LABEL` | `--contract-label` | `predinex` |
| `RPC_URL` (`STELLAR_RPC_URL` alias) | `--rpc-url` | Network default RPC endpoint |
| `NETWORK` | `--network` | `testnet` |
| `CONTRACT_ID` | `--contract` | Required |

Non-numeric, non-positive, or non-finite env values fall back to the defaults.
An invalid contract ID, network, or RPC URL is a fatal configuration error.
A missing contract ID is fatal. Normal below-threshold and above-threshold
checks both exit `0` after any alert is emitted; only fatal configuration or
source errors exit nonzero (`2` and `1` respectively).

## State and alerting

Samples are appended as NDJSON to the state file, keyed by network and a
truncated SHA-256 of the contract ID. The raw contract address is never written
to the file. Samples whose age is at least the window are pruned on every run.
The first sample for a pair only establishes a baseline; it cannot alert.

One alert is emitted per incident. While a breaching sample is still inside
the window, later breaches do not emit again. The monitor re-arms only after a
full window has passed with no breaching sample.

## Alert schema

Alerts are one JSON line on stdout at `error` level, with exactly these fields:

```json
{"alert":"fee_accumulator_growth","baselineStroops":10000000000,"contractLabel":"prod-mainnet","currentStroops":14000000000,"growthPct":40.0,"level":"error","msg":"fee_accumulator_growth_alert","network":"mainnet","rule":"delta_exceeds_max_of_threshold_pct_and_min_delta","runbook":"docs/FEE_ACCUMULATOR_MONITORING.md","service":"fee-accumulator-monitor","severity":"SEV-3","source":"pool_protocol_revenue","thresholdPct":25.0,"windowSecs":900}
```

Safe to log: `network`, `contractLabel` (a short operator-chosen label such as
`prod-mainnet`), and the numeric growth fields. Labels that look like a Stellar
address or contain unexpected characters are replaced with `predinex`.

**Never logged:** contract or account addresses, raw RPC errors, response
bodies, XDR, transaction hashes, market titles, or other free-text RPC data.
Fatal stderr messages are generic for the same reason.

`source` is `pool_protocol_revenue` for the primary monotonic accumulator or
`treasury_balance` for the fallback. `growthPct` is rounded to two decimals;
with a zero baseline it is `100.0` when the current value is positive.

## Running it

```bash
python3 scripts/check-fee-accumulator-growth.py --once \
  --network mainnet --contract "$CONTRACT_ID" --rpc-url "$RPC_URL" \
  --contract-label prod-mainnet

python3 scripts/check-fee-accumulator-growth.py --interval-seconds 300 \
  --network mainnet --contract "$CONTRACT_ID"
```

Cron (one check every five minutes):

```cron
*/5 * * * * NETWORK=mainnet CONTRACT_ID=C... RPC_URL=https://soroban-mainnet.stellar.org FEE_GROWTH_CONTRACT_LABEL=prod-mainnet /usr/bin/python3 /srv/predinex/scripts/check-fee-accumulator-growth.py --once >> /var/log/predinex/fee-accumulator.log 2>&1
```

systemd:

```ini
[Unit]
Description=Predinex fee accumulator growth monitor
After=network-online.target

[Service]
Type=simple
Environment=NETWORK=mainnet
Environment=CONTRACT_ID=C...
Environment=RPC_URL=https://soroban-mainnet.stellar.org
Environment=FEE_GROWTH_CONTRACT_LABEL=prod-mainnet
ExecStart=/usr/bin/python3 /srv/predinex/scripts/check-fee-accumulator-growth.py --interval-seconds 300
Restart=on-failure
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

## Triage

The alert defaults to SEV-3. Escalate to SEV-2 when growth remains above the
limit for more than 30 minutes, when `source` is `treasury_balance` and a
withdrawal is not known, or when the fee rate or treasury recipient was
recently changed.

1. Read `source`, `network`, `contractLabel`, `baselineStroops`,
   `currentStroops`, `growthPct`, and `windowSecs` from the alert.
2. Compare with [FEE_SCHEDULE.md](./FEE_SCHEDULE.md): expected growth follows
   settlement and claim volume; an abrupt jump can mean a fee-tier, cap, or
   withdrawal-limit change.
3. If `source` is `treasury_balance`, check for withdrawals before treating a
   low or negative delta as healthy. Re-run with the primary view restored.
4. Confirm the RPC endpoint and deployed contract with the read-only commands
   in [INCIDENT_RUNBOOK.md](./INCIDENT_RUNBOOK.md#1-severity-and-escalation).
5. Close the incident once a full window passes below the threshold and record
   the cause in the incident notes.

Unit tests: `python3 -m unittest discover -s scripts/tests -p 'test_fee_accumulator_monitor.py' -v`.
