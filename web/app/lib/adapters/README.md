# Predinex adapters

UI code should not import `@stacks/connect`, `@stacks/transactions`, or `getRuntimeConfig` directly when performing Predinex contract operations or chain reads that are already abstracted here.

## Modules

| Module | Role |
|--------|------|
| **`predinex-contract.ts`** | Wallet-facing writes: `place-bet`, `claim-winnings`. Encodes Clarity args and resolves contract id from runtime config. |
| **`predinex-read-api.ts`** | Read-only pool/market/user data (`predinexReadApi`) plus Hiro helpers (`getStacksCoreApiBaseUrl`, `fetchPredinexContractEvents`). Delegates to `stacks-api`. |
| **`batched-read-api.ts`** | Batched read layer (`batchedReadApi`) for reducing RPC fan-out. Groups semantically related reads (multiple pools, user bets) into concurrent batches with caching. **Prefer this for dashboard/portfolio screens.** |
| **`types.ts`** | Re-exports domain types (`Pool`, `ActivityItem`) so presentational components avoid importing `stacks-api` for types only. |

Lower-level modules (`stacks-api`, `appkit-transactions`) remain the implementation; adapters are the stable surface for pages and feature components.

## When to Use Batched Reads

Use `batchedReadApi` instead of `predinexReadApi` when:

- **Fetching multiple pools** (dashboard, compare, portfolio screens)
- **Fetching user bets across many pools** (active bets card, portfolio overview)
- **Rendering lists** where each row triggers an RPC call

### Example: Before (Sequential Fan-Out)

```ts
// ❌ BAD: O(n) sequential RPC calls
const pools = await fetchAllPools(); // returns pool IDs
for (const pool of pools) {
  const poolData = await predinexReadApi.getPool(pool.poolId);
  const userBet = await predinexReadApi.getUserBet(pool.poolId, userAddress);
  // ... render row
}
```

### Example: After (Batched + Cached)

```ts
// ✅ GOOD: O(1) batch with parallel execution + cache
import { batchedReadApi } from '@/app/lib/adapters';

const poolIds = [1, 2, 3, 4, 5];
const { pools, userBets } = await batchedReadApi.fetchUserPortfolioBatched(
  poolIds,
  userAddress
);

// pools and userBets are aligned by poolId
pools.forEach(({ poolId, pool }) => {
  const bet = userBets.find(b => b.poolId === poolId)?.bet;
  // ... render row
});
```

### Cache Invalidation

After mutations (place bet, claim winnings), invalidate the cache to force fresh reads:

```ts
import { invalidatePoolCache, invalidateUserCache } from '@/app/lib/adapters';

// After placing a bet
await predinexContract.placeBet(poolId, outcome, amount);
invalidatePoolCache(poolId);

// After wallet disconnect
invalidateUserCache(userAddress);
```

## Testing

- Mock `predinexContract`, `predinexReadApi`, or `batchedReadApi` in component tests instead of Stacks SDK modules.
- For read-path activity tests, prefer Soroban RPC/event-service payloads over legacy Stacks transaction shapes.
- Keep direct `@stacks/*` mocks only in compatibility suites that are explicitly labeled as such.
- See `web/tests/lib/predinex-contract-adapter.test.ts` for isolated adapter behavior.
- See `web/tests/lib/batched-read-api.test.ts` for batched read layer tests.
