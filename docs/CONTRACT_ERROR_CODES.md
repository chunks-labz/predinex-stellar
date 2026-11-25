# Predinex shared contract error codes

This registry standardizes error identifiers used by the Predinex market contract
and the standalone pool-duration contract. Numeric values are part of the
contract interface and must not be reused for a different meaning.

## Shared identifiers

| Code | Canonical meaning | Predinex contract | Pool contract |
| ---: | --- | --- | --- |
| 3 | Unauthorized | Unauthorized | Unauthorized |
| 7 | Pool expired | PoolExpired | PoolExpired |
| 9 | Pool not found | PoolNotFound | PoolNotFound |
| 10 | Pool not open | PoolNotOpen | PoolNotOpen |
| 37 | Duration exceeds maximum | DurationTooLong | MaxDurationExceeded |
| 96 | Expiry must increase | ExpiryMustIncrease | ExpiryMustIncrease |
| 97 | Expiry must be in the future | ExpiryMustBeFuture | ExpiryMustBeFuture |
| 98 | Pool is frozen or disputed | PoolLocked | PoolLocked |

Predinex values that pre-date this registry remain unchanged. Codes 96–98 were
appended to the existing Predinex ContractError enum. The standalone pool
contract now uses the same numbers for equivalent failures.

## Predinex-specific errors

| Code | Meaning |
| ---: | --- |
| 99 | TooManyAllowedTokens — multi-asset pool exceeds the allowed-token cap |
| 100 | TooManyWebhookEventTypes — webhook filter list exceeds supported event types |
| 101 | DuplicateWebhookEventType — webhook filter list repeats an event type |
| 102 | InvalidTradeBatchSize — a trade batch must contain 1 to 20 items |
| 103 | DuplicateOracleReport — the same reporter already settled this pool for this round |

## Upgrade and client compatibility

Changing numeric identifiers in an already deployed contract requires a
contract upgrade; existing ledger entries and historical transaction results
are not rewritten. Clients should select error decoding from the deployed
contract version rather than assuming old instances already use this registry.
Never renumber an existing Predinex error to make a new mapping fit: append a
new code and document it here.

Tests in both contract crates pin the shared numeric values so future changes
cannot silently introduce drift.
