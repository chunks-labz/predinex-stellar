# Trader Troubleshooting Guide

This guide covers the most common failures a trader encounters when placing bets, claiming winnings, or managing positions on Predinex. Each section states what went wrong, whether it is safe to retry, and how to resolve it.

For wallet setup and network configuration, see [`web/docs/WALLET_NETWORK_SUPPORT.md`](../web/docs/WALLET_NETWORK_SUPPORT.md). For contract error codes, see [`docs/CONTRACT_ERROR_CODES.md`](./CONTRACT_ERROR_CODES.md).

---

## 1. Disconnected or unresponsive wallet

### Symptoms

- The **Connect Wallet** button shows no account after clicking.
- Transactions fail immediately with "wallet not connected" before reaching the network.
- Freighter or WalletConnect shows a spinner and never resolves.

### Why it happens

The wallet extension is locked, the dApp lost its session (page reload, tab sleep), or the WalletConnect relay timed out.

### Resolution

1. Open your wallet extension (Freighter or WalletConnect-paired app) and confirm it is **unlocked and showing your address**.
2. On the Predinex UI, click **Disconnect** then **Connect Wallet** again to establish a fresh session.
3. If WalletConnect shows a stale session, tap **Disconnect all sessions** in your mobile app and reconnect from the QR code.
4. Hard-reload the page (`Ctrl+Shift+R` / `Cmd+Shift+R`) if the button is unresponsive.

**Safe to retry:** Yes, once the wallet reports a connected account.

---

## 2. Insufficient balance

### Symptoms

- Transaction rejected with `InsufficientBalance` or a wallet error before the transaction is submitted.
- The bet amount field turns red in the UI.

### Why it happens

Your XLM or token balance is too low to cover the bet amount plus the network base fee (minimum ~0.00001 XLM per operation). Soroban transactions require a resource fee on top of the base fee, which can reach 0.05–0.5 XLM for complex invocations.

### Resolution

1. Check your balance in the wallet extension or at `stellar.expert/explorer/mainnet/account/<your-address>`.
2. Ensure you hold enough XLM for:
   - The bet amount itself.
   - The minimum account reserve (2 XLM base + 0.5 XLM per open entry).
   - Estimated transaction fees (~0.1–0.5 XLM for Soroban contract calls).
3. If you are betting a custom Stellar asset (not XLM), confirm you have a trustline open for that asset and sufficient token balance.
4. Fund your account from an exchange or another wallet if needed.

**Safe to retry:** Yes, once your balance is sufficient.

---

## 3. Failed transaction simulation

### Symptoms

- The UI shows "Simulation failed" or "Transaction could not be built" before you are asked to sign.
- The wallet is never prompted.

### Why it happens

Soroban simulates every transaction before submission to estimate fees and validate inputs. Simulation fails when:

- The pool is closed, frozen, settled, or cancelled.
- The bet amount is below the minimum or violates a pool constraint.
- The contract is globally paused.
- An RPC connectivity issue prevents the simulation call from reaching the network.

### Resolution

1. **Reload the market page** to get the latest pool state. If the market closed in the last few minutes, the bet button will be disabled once the page refreshes.
2. **Check the pool status** in the market detail view. Only `Open` pools accept bets.
3. **Verify the pool is not paused or frozen.** A frozen pool shows a banner in the UI. A globally paused contract shows a site-wide maintenance banner.
4. **Try a different RPC endpoint.** Go to Settings → Network and select an alternative RPC URL. If the official Soroban RPC is degraded, check the [Stellar Network Status](https://status.stellar.org).
5. **Adjust the bet amount.** Some pools enforce a minimum bet. The UI will show the minimum; adjust accordingly.

**Safe to retry:** Yes, once the underlying cause is resolved (pool is open, RPC is reachable, amount meets the minimum).

---

## 4. Transaction rejected on submission (after signing)

### Symptoms

- You approved the transaction in your wallet but received an error response.
- The wallet shows the transaction as failed or the UI surfaces a contract error code.

### Common error codes and fixes

| Error | Code | Meaning | Fix |
|---|---|---|---|
| `PoolClosed` | 2 | Betting period has ended | The pool is no longer accepting bets; no action possible |
| `PoolAlreadySettled` | 7 | Pool was settled before your transaction landed | The pool is finished; claim if you won |
| `PoolIsFrozen` | 16 | Pool is under a freeze or dispute | Wait for the admin to unfreeze; check `#predinex-status` |
| `PoolIsDisputed` | 17 | Pool is in dispute resolution | Do not retry; wait for resolution |
| `ContractPaused` | 50 | Contract is globally paused | Wait for the maintenance window to end |
| `Unauthorized` | 3 | Signing key does not match the expected caller | Confirm you are signed in with the correct address |
| `InsufficientCreatorDeposit` | 65 | Creator deposit below minimum (1 XLM) | Increase the deposit when creating a pool |
| `NoBetFound` | 23 | Claim attempted but no winning bet on record | Verify the pool outcome and your bet outcome |
| `ResolutionNotFinal` | 94 | Claim attempted before the dispute window closed | Wait for the deadline to pass; use `get_resolution_deadline(pool_id)` |

**Safe to retry:** Depends on the error. Transient errors (network timeout, temporary RPC failure) are always safe to retry. Business-logic errors (`PoolClosed`, `PoolAlreadySettled`, `PoolIsDisputed`) will not succeed on retry until the underlying state changes.

---

## 5. Stale market state

### Symptoms

- The UI shows a pool as `Open` but your bet transaction fails with `PoolClosed`.
- Settlement or claim amounts shown in the UI differ from the on-chain result.
- The countdown timer appears stuck or shows the wrong time.

### Why it happens

The frontend caches market data and polls on a fixed interval (typically 15–30 seconds). If the pool expired or was settled between your last page load and your transaction, the UI can be out of sync.

### Resolution

1. **Hard-reload the market page** to force a cache refresh.
2. **Manually check the on-chain pool state:**
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ID> \
     --network mainnet \
     -- get_pool <pool-id>
   ```
   Look at `status`: `Open` accepts bets, `Settled` accepts claims, anything else does not.
3. **Wait for the UI to sync.** If the pool just closed, the frontend will reflect it within one polling cycle (~30 seconds).
4. If the displayed odds or totals look wrong after a reload, the pool may have high activity. The on-chain values in `get_pool` are always authoritative.

**Safe to retry:** Yes, after a fresh page load confirms the pool is still in the expected state.

---

## 6. Claim winnings failures

### Symptoms

- Clicking **Claim** produces an error.
- Nothing happens after signing the claim transaction.

### Checklist

| Check | How |
|---|---|
| Pool is settled (not disputed) | UI shows "Settled" badge; `get_pool` returns `status: Settled` |
| Dispute window has closed | `get_resolution_deadline(pool_id)` ≤ current time |
| You bet on the winning outcome | Your portfolio tab shows the pool with a winning flag |
| You have not already claimed | `NoBetFound` (23) means the claim was already processed |
| Contract is not paused | No maintenance banner; `is_paused()` returns `false` |

If `ResolutionNotFinal` (94) is returned, the dispute window is still open. The UI shows the finalization time. You can retry after that time, or call `finalize_resolution(pool_id)` on-chain (no auth required) once the deadline has passed, then claim.

**Safe to retry:** Yes, once the dispute window is closed and the pool status is `Settled`.

---

## 7. Referral reward not received

### Symptoms

- You referred a friend but no reward appeared in your balance.

### Why it happens

Referral rewards are paid from the **contract's funded balance**, not deducted from the bettor. If the contract balance is insufficient, the reward is silently skipped (no error). Rewards are also only paid when `get_referral_reward_bps() > 0`.

### Resolution

1. Confirm the referral reward rate: `get_fee_config()` and check the referral reward bps.
2. If the rate is zero, referral rewards are not currently active on this deployment.
3. Contact the protocol team via `#predinex-support` if you believe a reward was missed while the rate was active.

---

## 8. Where to get help

| Channel | Use for |
|---|---|
| `#predinex-support` (Discord) | General trader questions and UI issues |
| `#predinex-status` (Discord) | Planned maintenance and known outages |
| [Stellar Network Status](https://status.stellar.org) | Network-level RPC or ledger issues |
| [GitHub Issues](https://github.com/chunks-labz/predinex-stellar/issues) | Bug reports with transaction hashes and error codes |

When reporting a bug, include:
- The transaction hash (from your wallet history or Stellar Explorer).
- The pool ID.
- The exact error code or message.
- The network (mainnet or testnet).

---

## 9. Related documents

- [`CLAIM_LIFECYCLE.md`](./CLAIM_LIFECYCLE.md) — claim states, auto-finalization, and dispute flow
- [`FEE_CLAIM_WORKFLOW.md`](./FEE_CLAIM_WORKFLOW.md) — fee accrual and treasury claims (operators)
- [`CONTRACT_ERROR_CODES.md`](./CONTRACT_ERROR_CODES.md) — full error code reference
- [`web/docs/WALLET_NETWORK_SUPPORT.md`](../web/docs/WALLET_NETWORK_SUPPORT.md) — supported wallets and network configuration
- [`MARKET_LIFECYCLE.md`](./MARKET_LIFECYCLE.md) — pool states and transitions
