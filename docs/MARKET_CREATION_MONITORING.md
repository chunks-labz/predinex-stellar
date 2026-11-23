# Failed Market Creation Monitoring

`POST /api/markets` validates a request and submits `create_market` on-chain.
When that submission fails, the API records the attempt and alerts operators
once failures repeat (#1664). Source:
[`api/src/services/market-creation-monitor.ts`](../api/src/services/market-creation-monitor.ts).

## What is recorded

Each failure logs one `market_creation_failed` line at `warn` level (JSON, see
[LOGGING.md](./LOGGING.md)) and is kept in a bounded in-memory list:

| Field | Meaning |
| --- | --- |
| `at` | When the attempt failed (ISO-8601). |
| `correlationId` | The request's correlation ID; use it to find the request and its trace. |
| `category` | `contract`, `timeout`, `network`, `rejected` or `unknown` (see below). |
| `errorName` | Class of the thrown error, e.g. `Error`, `TimeoutError`. |
| `contractErrorCode` | The `Error(Contract, #N)` code when present; see [CONTRACT_ERROR_CODES.md](./CONTRACT_ERROR_CODES.md). |
| `outcomeCount` | Number of outcomes in the request. |
| `titleBytes` | Length of the title in bytes. |
| `secondsToClose` | Seconds between the attempt and the requested close time (negative if already past). |

**Never recorded:** the error message or stack, transaction XDR, signer or
source account, keys, and the request's title or outcome text. Those can carry
secrets or user content, and the fields above are enough to triage.

Categories:

- `contract`: the contract rejected the call (`Error(Contract, #N)`).
- `timeout`: the RPC or the submission timed out.
- `network`: the RPC could not be reached (connection refused, DNS, reset).
- `rejected`: the network rejected the transaction (`tx_failed`, insufficient
  balance or fee).
- `unknown`: anything else.

## Alert

When `MARKET_CREATION_FAILURE_ALERT_THRESHOLD` failures (default 5) happen
within `MARKET_CREATION_FAILURE_WINDOW_SECONDS` (default 900), the API logs one
line at `error` level:

```json
{"level":"error","msg":"market_creation_failure_alert","alert":"market_creation_failures",
 "failuresInWindow":5,"threshold":5,"windowSeconds":900,
 "categories":{"contract":4,"timeout":1},"runbook":"docs/MARKET_CREATION_MONITORING.md"}
```

It fires once per incident: it re-arms only after a full window passes with no
failures, so a sustained outage pages once.

The counter is per API process. With several instances, alert from the log
pipeline instead of relying on one process: count `market_creation_failed`
lines over the same window across all instances, and page on
`market_creation_failure_alert` from any instance.

Admins can read the current state:

```bash
curl -s -H "x-api-key: $ADMIN_API_KEY" https://api.example/api/markets/admin/creation-failures | jq .data
```

The response has `threshold`, `windowSeconds`, `recentFailures`,
`totalFailures`, `alerting`, `lastAlertAt` and the 50 most recent failures,
newest first.

## Triage

Severity: SEV-3 while failures are a mix of categories and some creations
still succeed. SEV-2 when every creation fails or the alert is still active
after 30 minutes.

1. **Read the state.** Open `/api/markets/admin/creation-failures` and note
   the dominant `category` and any `contractErrorCode`.
2. **Follow one request.** Search the logs for a failure's `correlationId` to
   see the full request, its span (if tracing is on), and the error the API
   returned to the client.
3. **By category:**
   - `contract`: look up the code in
     [CONTRACT_ERROR_CODES.md](./CONTRACT_ERROR_CODES.md). `ContractPaused`
     (50) means the contract is paused: follow
     [PAUSED_CONTRACT_RUNBOOK.md](./PAUSED_CONTRACT_RUNBOOK.md). Validation
     codes on otherwise valid API requests point to drift between the API's
     validation and the deployed contract. Check the deployed version with
     `GET /api/version` on the web app and compare it with the release.
   - `timeout` / `network`: the RPC is degraded. Follow
     [INCIDENT_RUNBOOK.md § RPC degraded or unavailable](./INCIDENT_RUNBOOK.md#4-rpc-degraded-or-unavailable).
   - `rejected`: check the submitting account's balance and fee settings;
     a drained source account rejects every transaction.
   - `unknown`: collect three correlation IDs and escalate to the API owner.
4. **Close.** The alert clears by itself once a full window passes without
   failures. Record the cause and the correlation IDs in the incident notes.
