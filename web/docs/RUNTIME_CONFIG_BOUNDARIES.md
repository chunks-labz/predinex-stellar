# Runtime Config Boundaries

This document defines which environment values are safe to expose in browser bundles and which values must stay server-only.

## Client-safe runtime config

The list of client-safe keys is **not maintained by hand**. It has one source of truth:

- `web/app/lib/env-boundary.ts` → `CLIENT_SAFE_RUNTIME_ENV_KEYS`

`web/tests/lib/env-boundary.test.ts` enforces two invariants against it, and both run in CI:

1. Every `process.env.<KEY>` access in `web/app` and `web/lib` (excluding server-only `app/api` route handlers) must appear in `CLIENT_SAFE_RUNTIME_ENV_KEYS`. Anything else fails the build, which is what stops a server-only secret from being inlined into the browser bundle.
2. Every key in `CLIENT_SAFE_RUNTIME_ENV_KEYS` must be documented in `web/.env.example`. A key that is missing there fails the build, because an operator auditing a deployment's environment cannot discover it and it silently takes whatever default the runtime config picks.

So to add a client-safe variable: add it to `CLIENT_SAFE_RUNTIME_ENV_KEYS`, then add it to `.env.example`. The test tells you which step you missed.

## Deprecated aliases

`web/app/lib/env-boundary.ts` → `DEPRECATED_RUNTIME_ENV_ALIASES` maps a superseded name to its canonical replacement. Deprecated aliases stay in both `CLIENT_SAFE_RUNTIME_ENV_KEYS` and `.env.example` so existing deployments keep working and operators can find and rename them; using one logs a one-time runtime warning.

Currently: `NEXT_PUBLIC_CONTRACT_ADDRESS` → `NEXT_PUBLIC_SOROBAN_CONTRACT_ID`. Both resolve to the same contract id and both feed `contract.address` and `soroban.contractId`.

## Build-time system keys in client source

These keys are read only for build/runtime mode checks and are not application secrets:

- `NODE_ENV`
- `CI`

## Server-only config

Any environment key not listed above is treated as server-only and must never be read from client modules.

Note that server-only values still belong in `.env.example` — `WEBHOOK_SECRET`, `VAPID_PRIVATE_KEY` and the `KV_REST_API_*` pair are all documented there. Being server-only means "never read from client modules", not "undocumented".

A `NEXT_PUBLIC_` value is compiled into the browser bundle, so it can never hold a secret. `NEXT_PUBLIC_WEBHOOK_SECRET` was removed for exactly that reason (#1286): the webhook signing key is now read server-side from `WEBHOOK_SECRET` in `web/app/api/webhooks/notify`.

Examples:

- `DATABASE_URL`
- `JWT_SECRET`
- `PRIVATE_KEY`
- `REDIS_URL`

## Guardrails

- `app/lib/env-boundary.ts` is the single allowlist for client env usage.
- `tests/lib/env-boundary.test.ts` scans `app/` and `lib/` source and fails if a non-allowlisted key is accessed through `process.env`.
- The test suite also includes a controlled negative test to verify server-only key exposure is rejected.
