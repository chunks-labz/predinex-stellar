# Runtime Config Boundaries

This document defines which environment values are safe to expose in browser bundles and which values must stay server-only.

## Client-safe runtime config

Only these `NEXT_PUBLIC_*` keys are allowed in client source:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_CONTRACT_ADDRESS`
- `NEXT_PUBLIC_CONTRACT_NAME`
- `NEXT_PUBLIC_ENABLE_ORACLE_MANAGEMENT_PLACEHOLDER`
- `NEXT_PUBLIC_NETWORK`
- `NEXT_PUBLIC_SOROBAN_CONTRACT_ID`
- `NEXT_PUBLIC_SOROBAN_RPC_URL`
- `NEXT_PUBLIC_TOKEN_NAME`
- `NEXT_PUBLIC_TOKEN_SYMBOL`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`

## Build-time system keys in client source

These keys are read only for build/runtime mode checks and are not application secrets:

- `NODE_ENV`
- `CI`

## Server-only config

Any environment key not listed above is treated as server-only and must never be read from client modules.

Examples:

- `DATABASE_URL`
- `JWT_SECRET`
- `PRIVATE_KEY`
- `REDIS_URL`

## Guardrails

- `app/lib/env-boundary.ts` is the single allowlist for client env usage.
- `tests/lib/env-boundary.test.ts` scans `app/` and `lib/` source and fails if a non-allowlisted key is accessed through `process.env`.
- The test suite also includes a controlled negative test to verify server-only key exposure is rejected.
