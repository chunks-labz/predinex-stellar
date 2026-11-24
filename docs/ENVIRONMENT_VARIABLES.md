# Environment Variables and Secrets

This is the cross-repository reference for variables and secrets required to run Predinex. Per-package example files remain the source of truth for the variables their code reads: [`web/.env.example`](../web/.env.example), [`api/.env.example`](../api/.env.example), and [`bot/DEPLOYMENT.md`](../bot/DEPLOYMENT.md).

> [!IMPORTANT]
> Any variable prefixed `NEXT_PUBLIC_` is inlined into the browser bundle at build time and is public. Never put a secret behind that prefix. Store secrets in the repository's Actions secrets or your deployment provider, never in source control.

---

## 1. Web application (`web/`)

Copy `web/.env.example` to `web/.env.local` (or configure the same names in Vercel). A CI check in `web/tests/lib/env-doc.test.ts` fails when source code reads a variable that is missing from the example file.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_NETWORK` | **Yes** | — | Network to connect to: `mainnet` or `testnet`. |
| `NEXT_PUBLIC_SOROBAN_CONTRACT_ID` | **Yes** | — | Deployed Soroban contract ID (`C…` strkey). Without it contract calls fail at the RPC layer; there is no startup guard. |

Variables that are optional overall but required for a specific feature:

| Variable | Required for | Default | Purpose |
| --- | --- | --- | --- |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Push notifications | — | Vercel KV (Upstash Redis) storage for push subscriptions across cold starts. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect UI | — | WalletConnect Cloud project ID. |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Custom RPC endpoint | Network default | Overrides the RPC URL selected for `NEXT_PUBLIC_NETWORK`. |
| `WEBHOOK_SECRET` | Signed outbound webhooks | — | Server-only HMAC-SHA256 signing key. Never use a `NEXT_PUBLIC_` prefix. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` with `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push delivery | — | VAPID keypair and subject; the private key must stay server-side. |
| `BUILD_COMMIT_SHA`, `BUILD_TIME` | `GET /api/version` build metadata | `VERCEL_GIT_COMMIT_SHA` / `GITHUB_SHA`, unset | Commit (7–40 hex) and ISO-8601 time of the build, captured at build time and checked by the preview smoke test (#1665). |

The fixture switches (`NEXT_PUBLIC_ACTIVITY_FIXTURES`, `NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA`, `NEXT_PUBLIC_ENABLE_ORACLE_MANAGEMENT_PLACEHOLDER`) must remain `false` in production: they serve synthetic data and a healthy-looking but fake UI.

---

## 2. API (`api/`)

Copy `api/.env.example` to `api/.env`. See [`api/README.md`](../api/README.md) for route-level auth details.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AUTH_SECRET` | **Yes** | — | HMAC secret for payload signing and verification. The server refuses to start when it is missing or blank. Generate a fresh value per deployment (`openssl rand -hex 32`). |
| `ADMIN_API_KEYS`, `OFFICER_API_KEYS`, `ASSESSOR_API_KEYS` | Protected API routes | — | Comma-separated `x-api-key` values per role. |
| `USER_API_KEYS` | Per-user trade exports | — | Comma-separated `apiKey=G…` bindings. |
| `PORT` | No | `3001` | HTTP listen port. |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_STRICT_MAX_REQUESTS` | No | `60000`, `100`, `20` | Rate-limit window and request budgets. Invalid values fall back to defaults. |
| `OTEL_TRACING_ENABLED`, `OTEL_SERVICE_NAME` | No | `false`, `predinex-api` | Opt-in OTLP tracing; also set the standard `OTEL_EXPORTER_OTLP_ENDPOINT` when enabled. |
| `MARKET_CREATION_FAILURE_ALERT_THRESHOLD`, `MARKET_CREATION_FAILURE_WINDOW_SECONDS` | No | `5`, `900` | Failed on-chain market creations within the window that trigger a `market_creation_failure_alert` log. See [MARKET_CREATION_MONITORING.md](./MARKET_CREATION_MONITORING.md). Invalid values fall back to defaults. |

---

## 3. Automation bot (`bot/`)

The full table is in [`bot/DEPLOYMENT.md`](../bot/DEPLOYMENT.md). The minimum required set is:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `STELLAR_RPC_URL` | **Yes** | — | Soroban RPC endpoint. |
| `CONTRACT_ID` | **Yes** | — | Predinex contract ID (`C…` strkey). |
| `BOT_SECRET_KEY` | **Yes** | — | Bot wallet secret; must be a contract admin. Treat it as a root credential. |

`STELLAR_NETWORK` defaults to `testnet`. `AUTO_SETTLE_ENABLED`, oracle settings, webhook settings, and retry knobs are optional and documented in the bot deployment guide. Webhook delivery alerts are configured with `WEBHOOK_FAILURE_ALERT_THRESHOLD`, `WEBHOOK_FAILURE_WINDOW_SECONDS`, and optional `WEBHOOK_CONSUMER_NAME`; see [WEBHOOK_DELIVERY_MONITORING.md](./WEBHOOK_DELIVERY_MONITORING.md).

---

## 4. GitHub Actions secrets

Secrets are configured under the repository's **Settings → Secrets and variables → Actions**. `GITHUB_TOKEN` is provided automatically and does not need to be created.

| Secret | Workflow | Required | Purpose |
| --- | --- | --- | --- |
| `STELLAR_TESTNET_SECRET_KEY` | `deploy-testnet.yml` | **Yes** | Testnet deployer key; also becomes the contract treasury. |
| `MAINNET_DEPLOYER_SECRET` | `deploy-mainnet.yml` | **Yes** | Mainnet deployer key. |
| `MAINNET_XLM_SAC` | `deploy-mainnet.yml` | **Yes** | XLM Stellar Asset Contract ID used during initialization. |
| `MAINNET_TREASURY_ADDRESS` | `deploy-mainnet.yml` | **Yes** | Treasury recipient; the workflow fails when it is empty. |
| `VALIDATION_CLOUD_KEY` | `deploy-mainnet.yml` | **Yes** | Key used in the Validation Cloud mainnet RPC URL. |
| `STELLAR_MAINNET_BETTOR_SECRET_KEY` | `deploy-mainnet.yml` | Only with `run_lifecycle_smoke: true` | Pre-funded bettor key for the paid settlement smoke test. |
| `VERCEL_TOKEN` | `preview-deploy.yml` | **Yes**, for preview deploys | Vercel CLI authentication. |
| `VERCEL_ORG_ID` | `preview-deploy.yml` | **Yes**, for preview deploys | Vercel organization ID. |
| `VERCEL_PROJECT_ID` | `preview-deploy.yml` | **Yes**, for preview deploys | Vercel project ID. |
| `MAINNET_CONTRACT_ID` | `verify-contract-bytecode.yml` | When no contract ID is supplied to the workflow | Deployed mainnet contract to verify. |
| `TESTNET_CONTRACT_ID` | `verify-contract-bytecode.yml` | When no contract ID is supplied to the workflow | Deployed testnet contract to verify. |
| `PAT_TOKEN` | `tag-release.yml` | **Yes**, for release tags | Personal access token whose tag push triggers downstream workflows; `GITHUB_TOKEN` deliberately does not. |
| `GITLEAKS_LICENSE` | `secrets-scan.yml` | No | Gitleaks Pro license key. |

Forks of this repository do not have these secrets; the deploy and preview workflows skip themselves on forks instead of failing noisily.

---

## 5. Removed or renamed variables

| Old name | Use instead |
| --- | --- |
| `NEXT_PUBLIC_CONTRACT_ID` | `NEXT_PUBLIC_SOROBAN_CONTRACT_ID` |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | `NEXT_PUBLIC_SOROBAN_CONTRACT_ID` (the old alias is deprecated and scheduled for removal) |
| `NEXT_PUBLIC_TOKEN_ID`, `NEXT_PUBLIC_NETWORK_PASSPHRASE` | No longer read by the web app; remove them |
| `NEXT_PUBLIC_STACKS_API_URL` | No longer read by the web app; remove it |
| `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL` | No workflow reads these; remove them |
