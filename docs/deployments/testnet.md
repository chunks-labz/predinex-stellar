# Testnet deployments

Automated by `.github/workflows/deploy-testnet.yml` on every push to `main` that
touches `contracts/**`, plus manual `workflow_dispatch` runs.

Each successful deploy posts a summary on the associated PR with the contract ID,
deploy/initialize transaction hashes, and smoke-test result. The same data is
attached to the workflow run as the `deployment-manifest` artifact
(`deployment.json`, retained 90 days).

This file is intentionally kept short — the workflow is the source of truth.
Search for "Testnet deploy" PR comments or download recent deployment manifests
to find the current and recent contract IDs.

| Network | XLM token (SAC) |
| --- | --- |
| testnet | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

## Required secrets

| Name | Required | Purpose |
| --- | --- | --- |
| `STELLAR_TESTNET_SECRET_KEY` | Yes | Deployer key (S…). Becomes the contract treasury. |
| `SLACK_WEBHOOK_URL` | Optional | Slack notification on success/failure. |
| `DISCORD_WEBHOOK_URL` | Optional | Discord notification on success/failure. |

When a webhook secret is absent the corresponding notification step is skipped
without failing the workflow.

## Smoke coverage

The workflow exercises the full critical path:

1. `stellar contract build` and `stellar contract optimize`.
2. Contract deploy + `initialize(token, treasury_recipient, admin)`.
3. `get_pool_count` (before).
4. `create_pool(...)` with fixture args (minimum 300s duration) — returns the
   new pool id.
5. `get_pool_count` (after) — must equal `before + 1`.
6. `place_bet(...)` from a **second account funded via friendbot** (distinct
   from the deployer), staking on outcome 0.
7. A synthetic wait (`sleep 330`) until the pool's 300s duration elapses.
8. `settle_pool(...)` by the admin (deployer) with outcome 0 as the winner.
9. `claim_winnings(...)` by the bettor — the returned payout must be positive.

This covers the previously deferred `place_bet` / `settle` / `claim_winnings`
path. The second key is generated and funded inside the job, so no additional
secret is required on testnet.

> **Mainnet note.** `deploy-mainnet.yml` shares this smoke logic, but the
> betting lifecycle (steps 6–9) is **opt-in** there: mainnet has no friendbot
> and the cycle spends real XLM and waits ~5 minutes. Enable it by running the
> workflow with the `run_lifecycle_smoke` input set to `true` and configuring a
> pre-funded `STELLAR_MAINNET_BETTOR_SECRET_KEY` secret. When disabled, mainnet
> still runs the deploy + `create_pool` smoke (steps 1–5).

See `rollback.md` for what to do when a deploy lands a broken contract.
