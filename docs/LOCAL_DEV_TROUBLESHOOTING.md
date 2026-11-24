# Local Development Troubleshooting

Use this guide for common setup failures. For a clean setup, start with the
[developer onboarding guide](./DEVELOPER_ONBOARDING.md) or
[local end-to-end runbook](./local-runbook.md). The optional pinned-toolchain
container is documented in [LOCAL_DEV_CONTAINER.md](./LOCAL_DEV_CONTAINER.md).

## Web app reports missing environment variables or contract ID

- **Symptoms:** The page reports `NEXT_PUBLIC_NETWORK` is missing, contract
  calls fail, or the app cannot determine a contract ID.
- **Cause:** `web/.env.local` was not created, the required values are blank,
  or the dev server was started before the file was changed.
- **Fix:** From the repository root, copy `web/.env.example` to
  `web/.env.local` and set `NEXT_PUBLIC_NETWORK=testnet` and
  `NEXT_PUBLIC_SOROBAN_CONTRACT_ID` to a testnet contract. Restart `npm run
  dev` from `web/`. See the [local runbook environment setup](./local-runbook.md#3-wire-the-web-app)
  and [environment variable reference](./ENVIRONMENT_VARIABLES.md#1-web-application-web).

## API refuses to start

- **Symptoms:** Startup reports a missing `AUTH_SECRET`, or protected API calls
  fail because an API key is missing or has the wrong role.
- **Cause:** The API environment file was not configured; `AUTH_SECRET` is
  required and has no default.
- **Fix:** Copy `api/.env.example` to `api/.env`, generate a local secret with
  `openssl rand -hex 32`, and set the role keys needed by your routes. Follow
  the [API quick start](../api/README.md#quick-start-http-server) and
  [API environment reference](./ENVIRONMENT_VARIABLES.md#2-api).

## Migration checks cannot connect to PostgreSQL

- **Symptoms:** `verify-migrations.sh` or its tests report connection refused
  on `127.0.0.1:55432`, or `pg_isready` never succeeds.
- **Cause:** The throwaway PostgreSQL service used for migration tests is not
  running, is still starting, or is not mapped to port `55432`.
- **Fix:** Start the Postgres 16 container and wait for `pg_isready` using the
  commands in [MIGRATIONS.md](./MIGRATIONS.md#running-it-locally), then rerun
  the migration check. The web and API dev servers do not require this
  database; only the migration checks do.

## Testnet transactions fail for insufficient balance

- **Symptoms:** Wallet connection works, but pool creation, betting, or
  contract deployment fails with insufficient XLM or transaction fees.
- **Cause:** The selected testnet account has not been funded, or Freighter is
  connected to a different account/network than the app.
- **Fix:** Select the intended account and **Testnet** in Freighter. For a CLI
  deployer, use `stellar keys fund deployer --network testnet`; the
  [local runbook](./local-runbook.md#2a-create-or-fund-a-testnet-account)
  explains the full account setup. Review [supported wallet and network
  combinations](../web/docs/WALLET_NETWORK_SUPPORT.md).

## Wallet is not detected or reports the wrong network

- **Symptoms:** The app says no wallet is detected, connection is rejected, or
  the connected network does not match the app.
- **Cause:** Freighter is not installed/enabled, the wrong network is selected,
  or a previously connected account is still active.
- **Fix:** Enable the Freighter browser extension, switch it to the same
  network configured by `NEXT_PUBLIC_NETWORK`, reconnect, and reload the app.
  See [wallet and network support](../web/docs/WALLET_NETWORK_SUPPORT.md).

## Stellar RPC or contract calls time out

- **Symptoms:** The UI cannot load markets or contract transactions remain
  pending/fail to submit.
- **Cause:** The RPC endpoint is unavailable, the configured network does not
  match the contract ID, or a local standalone Stellar container is stopped.
- **Fix:** Check `NEXT_PUBLIC_NETWORK` and the contract ID together, confirm
  the RPC setting in `web/.env.local`, and retry against the network's default
  endpoint. For local standalone development, start it with
  `stellar container start local` as described in the
  [local runbook](./local-runbook.md).

## Contract build cannot find the WASM target or Stellar CLI

- **Symptoms:** `stellar contract build` reports a missing target, or the shell
  says `stellar: command not found`.
- **Cause:** The Rust WASM target or Stellar CLI is not installed in the active
  environment.
- **Fix:** Run `rustup target add wasm32-unknown-unknown` and install the
  [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup).
  Check the required versions in the [developer onboarding prerequisites](./DEVELOPER_ONBOARDING.md#prerequisites).
