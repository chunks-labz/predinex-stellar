# Place-Wager SDK Helper

`placeWager()` is the typed entry point for placing a wager on a Predinex
market. It replaces hand-rolled `place_bet` transaction assembly with one
function that validates input, encodes the outcome and amount exactly as the
contract expects, submits through the connected wallet, and returns a
structured result with the transaction hash.

Source: [`web/app/lib/place-wager.ts`](../app/lib/place-wager.ts) (issue #1439).

---

## Quick start

```ts
import { placeWager } from '@/app/lib/place-wager';

// `wallet` is a connected Freighter client (see FreighterWalletClient).
const result = await placeWager({
  wallet,
  poolId: 12,
  outcome: 'B',            // or 1 / 'b'; 'A' / 0 is the other outcome
  amountStroops: 5_000_000, // 0.5 XLM (1 XLM = 10_000_000 stroops)
});

console.log(`Wager submitted: ${result.txHash}`);
```

The helper:

1. Validates every input **before** any network call.
2. Encodes the outcome to the contract's `u32` index (`'A' → 0`, `'B' → 1`).
3. Submits `place_bet(user, pool_id, outcome, amount, Option<Address>)` through
   the wallet-prompt adapter, with cache invalidation on success.
4. Returns a `PlaceWagerResult` including the transaction hash.

## Parameters

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `wallet` | `FreighterWalletClient` | yes | Must be connected (`wallet.address` set). |
| `poolId` | `number` | yes | Integer `1 … 4294967295` (u32). |
| `outcome` | `0 \| 1 \| 'A' \| 'B' \| 'a' \| 'b'` | yes | `'A'`/`0` → first outcome, `'B'`/`1` → second. |
| `amountStroops` | `number \| bigint \| string` | yes | Positive integer stroops, at most `i128` max. |
| `referrer` | `string \| null` | no | Stellar account id (`G...`); must differ from the wager address. |
| `onStageChange` | `(stage) => void` | no | Progress: `simulating → signing → submitting → polling → success`. |
| `onFeeEstimated` | `(feeStroops) => Promise<boolean>` | no | Return `false` to abort before signing. |

## Result

```ts
interface PlaceWagerResult {
  status: 'SUCCESS';      // failures reject instead
  txHash: string;         // Stellar transaction hash
  poolId: number;
  outcome: 0 | 1;         // encoded index submitted
  outcomeLabel: 'A' | 'B';
  amountStroops: string;  // exact amount (BigInt serialized)
  referrer: string | null;
  submittedAt: string;    // ISO timestamp
}
```

## Fail-fast validation

Invalid input throws a `WagerValidationError` with the offending `field`
before the wallet is prompted or any RPC call is made:

```ts
import { placeWager, WagerValidationError } from '@/app/lib/place-wager';

try {
  await placeWager({ wallet, poolId: 12, outcome: 'C', amountStroops: 5_000_000 });
} catch (error) {
  if (error instanceof WagerValidationError) {
    console.error(`${error.field}: ${error.message}`);
    // outcome: outcome must be 0 or "A" for the first outcome, or 1 or "B" for the second (got "C")
  }
}
```

| Field | Rule |
|-------|------|
| `wallet` | Connected wallet with a non-empty `address`. |
| `poolId` | Integer between `1` and `4294967295`. |
| `outcome` | `0`, `1`, `'A'`, `'a'`, `'B'`, or `'b'`. |
| `amountStroops` | Positive integer (number, bigint, or decimal string) ≤ `2^127 - 1`. |
| `referrer` | Empty/`null` → no referrer; otherwise a valid `G...` account id that differs from the wager address. |

Submission failures (simulation errors, rejected signatures, network issues)
are propagated unchanged, so existing error handling still applies.

## Advanced: custom submitter

`placeWager` accepts a `submit` dependency for custom signers (server-side
keypairs, sponsored transactions) or tests:

```ts
import { placeWager, type PlaceBetSubmitter } from '@/app/lib/place-wager';

const submit: PlaceBetSubmitter = async (encoded) => {
  // encoded: { wallet, poolId, outcome, amountStroops, referrer, ... }
  // e.g. route through your own SorobanTransactionService instance
  const { txHash } = await mySubmitter(encoded);
  return { txHash };
};

const result = await placeWager(
  { wallet, poolId: 12, outcome: 'A', amountStroops: 1_000n },
  { submit }
);
```

Without `submit`, the helper uses the standard wallet adapter
(`predinexContract.placeBetSoroban`), which prompts Freighter, applies the
configured Soroban RPC/contract coordinates, and invalidates the market
caches on success (issue #990).

## Low-level building blocks

The individual validators are exported separately if you need them outside
the full flow:

- `encodeWagerOutcome(outcome)` → `0 | 1`
- `validatePoolId(poolId)` → `number`
- `validateWagerAmount(amountStroops)` → `bigint`
- `validateReferrer(referrer, wagerAddress?)` → `string | null`
- `normalizePlaceWagerParams(params)` → `{ poolId, outcome, amountStroops, referrer }`
