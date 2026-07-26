# Settlement Bot — Deployment Guide

The settlement bot is a headless Node.js process that periodically scans the
Predinex contract for expired-but-unsettled pools and calls `settle_pools` on-chain.

## Prerequisites

- **Node.js 18+** (or Docker)
- A Stellar account that is the **contract admin** (the bot wallet)
- The deployed Predinex contract ID

---

## Quick Start (local / dev)

```bash
cd bot
npm install
cp .env.example .env
# Fill in .env with your values
npm run build
npm start

# OR: skip the build and run TypeScript directly
npx ts-node --esm src/index.ts

# Dry-run: scan and log without submitting transactions
DRY_RUN=true npm start
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `STELLAR_RPC_URL` | ✅ | — | Soroban RPC endpoint |
| `STELLAR_NETWORK` | — | `testnet` | `testnet` or `mainnet` |
| `CONTRACT_ID` | ✅ | — | Predinex contract ID (C… strkey) |
| `BOT_SECRET_KEY` | ✅ | — | Bot wallet secret key (must be contract admin) |
| `POLL_INTERVAL_MS` | — | `300000` | Poll interval (ms). 300000 = 5 minutes |
| `BATCH_SIZE` | — | `100` | Pools read per RPC call (max 100) |
| `DRY_RUN` | — | `false` | If `true`, scan and log but submit no transactions |
| `AUTO_SETTLE_ENABLED` | — | `false` | If `false`, bot logs expired pools but does not settle |
| `DEFAULT_WINNING_OUTCOME` | — | `0` | Winning outcome index used when `AUTO_SETTLE_ENABLED=true` |
| `MAX_RETRIES` | — | `3` | Max transaction retry attempts |
| `RETRY_BASE_DELAY_MS` | — | `1000` | Base delay for exponential back-off (ms) |
| `WEBHOOK_URL` | — | — | Optional POST endpoint for settlement notifications |
| `WEBHOOK_SECRET` | — | — | HMAC-SHA256 secret for webhook signature header |
| `LOG_LEVEL` | — | `info` | `debug`, `info`, `warn`, `error` |

> **Security note**: `BOT_SECRET_KEY` gives full admin control over the contract.
> Treat it like a root password. Use a secrets manager in production — never
> commit it to source control.

---

## Auto-Settlement and Oracle Integration

By default, `AUTO_SETTLE_ENABLED=false`. In this mode the bot is an **alerting
agent** only — it logs every expired unsettled pool to stdout but does not
submit any transactions. A human admin can review the output and call
`settle_pool` manually.

To enable automatic settlement, set `AUTO_SETTLE_ENABLED=true`. The bot will
then settle every expired pool using `DEFAULT_WINNING_OUTCOME`.

**For production markets with real funds you MUST integrate an oracle.** Edit
`bot/src/poller.ts` and implement the `resolveWinningOutcome()` function:

```typescript
async function resolveWinningOutcome(
  poolId: number,
  pool: Pool,
  config: BotConfig,
): Promise<number | null> {
  // Call your oracle or price feed here
  const res = await fetch(`https://oracle.example.com/resolve/${poolId}`);
  const { outcome } = await res.json() as { outcome: number };
  return outcome; // 0 = outcome_a wins, 1 = outcome_b wins
}
```

Return `null` to skip a pool (it will be logged as needing manual settlement).

---

## Docker

### Build and run locally

```bash
cd bot
docker build -t predinex-settlement-bot .
docker run --rm \
  -e STELLAR_RPC_URL="https://soroban-testnet.stellar.org" \
  -e STELLAR_NETWORK="testnet" \
  -e CONTRACT_ID="C..." \
  -e BOT_SECRET_KEY="S..." \
  -e AUTO_SETTLE_ENABLED="true" \
  predinex-settlement-bot
```

### docker-compose

```bash
cd bot
cp .env.example .env
# Edit .env
docker compose up -d
docker compose logs -f
```

---

## Deploy to Railway

[Railway](https://railway.app) is the simplest cloud option — supports
environment variables natively and auto-restarts on crashes.

1. Push the `bot/` directory to a GitHub repository (or the monorepo).

2. In Railway, create a new project → **Deploy from GitHub**.

3. Set the **Root Directory** to `bot/`.

4. Railway will detect the `Dockerfile` and build it automatically.

5. Add environment variables in the Railway dashboard:
   ```
   STELLAR_RPC_URL=https://soroban-mainnet.stellar.org
   STELLAR_NETWORK=mainnet
   CONTRACT_ID=C...
   BOT_SECRET_KEY=S...
   AUTO_SETTLE_ENABLED=true
   POLL_INTERVAL_MS=300000
   LOG_LEVEL=info
   ```
   Set `BOT_SECRET_KEY` as a **Railway Secret** (encrypted at rest).

6. Click **Deploy**. Railway starts the container and restarts it on failure.

Railway logs stream in the dashboard and can be forwarded to Datadog, Logtail,
or any log drain via the Railway integrations panel.

---

## Deploy to Fly.io

[Fly.io](https://fly.io) runs containers close to your users. Suits bots
because it auto-restarts and has a simple secrets management system.

### One-time setup

```bash
cd bot

# Install flyctl if needed
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch (creates fly.toml — do this once)
fly launch --no-deploy --name predinex-settlement-bot
```

Fly will create a `fly.toml`. Adjust it:

```toml
[build]
  dockerfile = "Dockerfile"

[env]
  STELLAR_NETWORK = "mainnet"
  STELLAR_RPC_URL = "https://soroban-mainnet.stellar.org"
  LOG_LEVEL       = "info"
  AUTO_SETTLE_ENABLED = "true"
  POLL_INTERVAL_MS    = "300000"
  DRY_RUN             = "false"

# No HTTP server needed — this is a background worker
[[services]]
  # Empty — no inbound ports
```

### Set secrets (never use env for the secret key)

```bash
fly secrets set CONTRACT_ID="C..."
fly secrets set BOT_SECRET_KEY="S..."
fly secrets set WEBHOOK_SECRET="your-webhook-secret"
```

### Deploy

```bash
fly deploy
fly logs  # stream logs
fly status
```

### Scale to zero (when not in use)

```bash
fly scale count 0  # stop
fly scale count 1  # start again
```

---

## Monitoring and Alerting

The bot emits structured JSON logs to stdout/stderr. Each log line contains:
- `ts` — ISO-8601 timestamp
- `level` — `debug` | `info` | `warn` | `error`
- `msg` — human-readable message
- Additional structured fields (poolId, txHash, etc.)

**Key log messages to monitor:**

| Message | Level | Meaning |
|---|---|---|
| `"Pool needs manual settlement"` | `warn` | Expired pool needs admin attention |
| `"settle_pools batch succeeded"` | `info` | Settlement confirmed on-chain |
| `"settle_pools batch failed"` | `error` | All retries exhausted — investigate |
| `"Pool has failed to settle repeatedly"` | `error` | Same pool failing 3+ cycles — manual action needed |
| `"Settlement cycle encountered unhandled error"` | `error` | Bug or network issue |

Set up alerts in your log aggregator for any `"level":"error"` lines.

### Webhook notifications

Set `WEBHOOK_URL` to receive a POST after each cycle that contains settlements.
Verify the `X-Predinex-Signature` header (HMAC-SHA256 of the request body using
`WEBHOOK_SECRET`) to authenticate the sender:

```typescript
import { createHmac } from "crypto";

function verifyWebhook(body: string, secret: string, header: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return expected === header;
}
```

---

## Security Checklist

- [ ] Bot wallet holds only enough XLM for transaction fees (~1 XLM buffer is sufficient)
- [ ] `BOT_SECRET_KEY` is stored in a secrets manager (Railway secrets, Fly secrets, AWS Secrets Manager, etc.) — never in source control or plaintext files
- [ ] `WEBHOOK_SECRET` is set so webhook consumers can verify requests
- [ ] Firewall / egress rules allow only the Soroban RPC endpoint
- [ ] Alerts configured for `error`-level log messages
- [ ] `DRY_RUN=true` tested before enabling `AUTO_SETTLE_ENABLED=true` in production

---

## Troubleshooting

**"Not initialized" error from contract**
The contract has not been initialized. Ensure the contract is deployed and initialized before running the bot.

**"Unauthorized" error on settle**
The bot wallet is not the contract admin. Check `CONTRACT_ID` and `BOT_SECRET_KEY`.

**"PoolNotExpired" in simulation**
A pool appeared expired during the scan but the ledger timestamp advanced before the transaction was submitted. The bot skips these automatically (no retry). This is harmless and self-correcting.

**Bot stops settling after a while**
The bot wallet may have run out of XLM for transaction fees. Top up the account with `stellar friendbot` (testnet) or send XLM (mainnet).

**High sequence number errors**
Ensure only one bot instance runs per wallet. Multiple instances racing with the same key will cause sequence number conflicts.
