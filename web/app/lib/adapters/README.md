# Predinex adapters

UI code should not import `@stacks/connect`, `@stacks/transactions`, or `getRuntimeConfig` directly when performing Predinex contract operations or chain reads that are already abstracted here.

## Modules

| Module | Role |
|--------|------|
| **`predinex-contract.ts`** | Wallet-facing writes: `place-bet`, `claim-winnings`. Encodes Clarity args and resolves contract id from runtime config. |
| **`predinex-read-api.ts`** | Read-only pool/market/user data (`predinexReadApi`) plus Hiro helpers (`getStacksCoreApiBaseUrl`, `fetchPredinexContractEvents`). Delegates to `stacks-api`. |
| **`types.ts`** | Re-exports domain types (`Pool`, `ActivityItem`) so presentational components avoid importing `stacks-api` for types only. |

Lower-level modules (`stacks-api`, `appkit-transactions`) remain the implementation; adapters are the stable surface for pages and feature components.

## Testing

- Mock `predinexContract` or `predinexReadApi` in component tests instead of Stacks SDK modules.
- For read-path activity tests, prefer Soroban RPC/event-service payloads over legacy Stacks transaction shapes.
- Keep direct `@stacks/*` mocks only in compatibility suites that are explicitly labeled as such.
- See `web/tests/lib/predinex-contract-adapter.test.ts` for isolated adapter behavior.
