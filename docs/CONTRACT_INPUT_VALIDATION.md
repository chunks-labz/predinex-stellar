# Contract Input Validation Audit

This audit documents the public-entrypoint validation paths for the Predinex
Soroban contract.

## Address Parameters

Soroban `Address` values are SDK-typed and authenticated with `require_auth`
where authority is required. Admin-only calls compare the authenticated caller
against the stored treasury recipient or freeze admin. The SDK does not expose a
zero-address sentinel, so zero-address validation is covered by typed address
construction plus auth checks.

## Strings

Pool and template titles, descriptions, and outcome labels reject empty and
whitespace-only strings. Maximum byte lengths are enforced for titles,
descriptions, outcomes, and metadata URIs. Multi-outcome pools reject too few,
too many, and duplicate normalized labels. Metadata URIs are limited to
`https://`, `ipfs://`, or `ar://`.

## Numeric Bounds

Durations enforce minimum and maximum lifetimes and checked expiry arithmetic.
Bet amounts must be positive, respect configured per-pool min/max values, and
use checked arithmetic for pool totals and user totals. Protocol fee and
creation fee setters enforce bounds and non-negative values. Treasury
withdrawals reject non-positive and over-balance amounts.

## Scheduled Pools

`schedule_pool` reuses normal pool string/outcome/duration validation, requires
`open_at` to be in the future, and caps scheduling at 30 days. Scheduled pools
remain non-bettable until `activate_scheduled_pool` is called at or after
`open_at`. Creator cancellation before activation moves the pool to
`Cancelled`.

## Scheduled Claims

`schedule_claim` requires a future claim timestamp, an existing pool, an
existing user position, and at most one pending claim per user/pool.
`execute_scheduled_claims` processes only due entries, caps execution at 10 per
call, and delegates payout to the same internal validation/accounting path as
`claim_winnings`.

## Treasury Withdrawal Rate Limit

`set_treasury_withdraw_limit` accepts either both zero values to disable the
limit, or positive max/window values. `withdraw_treasury` tracks cumulative
withdrawals in the active window and rejects calls that exceed the configured
capacity. The window resets after `withdrawal_window_secs`.

## Error Consistency

The contract already uses the maximum exported Soroban custom-error case count,
so new validation paths reuse existing typed errors instead of expanding the
ABI: duration errors for schedule timestamp bounds, `PoolNotExpired` for early
scheduled execution, `InvalidRateLimitConfig` for invalid withdrawal-limit
configuration, and `RateLimitExceeded` for withdrawal window exhaustion.
