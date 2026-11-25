# Admin Recovery Procedures

This document gives step-by-step procedures for the most common administrative recovery scenarios in Predinex. Each section states the preconditions, the exact command sequence, the verification check, and the rollback if the action needs to be undone.

For general incident severity levels and escalation, see [`INCIDENT_RUNBOOK.md`](./INCIDENT_RUNBOOK.md). For the pause-specific runbook, see [`PAUSED_CONTRACT_RUNBOOK.md`](./PAUSED_CONTRACT_RUNBOOK.md). For oracle key rotation, see [`ORACLE_ROTATION.md`](./ORACLE_ROTATION.md).

> **Never paste secret keys into an incident channel.** Record that a key was used or rotated, not the key value itself.

---

## Shell variables

Set these once per session before running any command below. Replace each placeholder with the real value from your secrets manager or `.env.example`.

```bash
export CONTRACT_ID=C...                              # deployed predinex contract
export NETWORK=mainnet                               # or testnet
export RPC_URL=https://soroban-mainnet.stellar.org
export ADMIN=G...                                    # get_admin()
export TREASURY=G...                                 # get_treasury_recipient()
export FREEZE_ADMIN=G...                             # get_freeze_admin()
```

---

## 1. Pause the contract

**When to use:** Funds are at risk, settlement integrity is in question, or a critical bug is being actively exploited. This is a SEV-1 action. Record the reason in the incident channel before executing.

**Authorized callers:** Admin or treasury recipient.

### Steps

1. Confirm the current contract state:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network $NETWORK \
     -- is_paused
   # Expected: false
   ```

2. Pause the contract:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network $NETWORK \
     --source-account <admin-or-treasury-secret-key> \
     -- pause_contract \
       --caller $ADMIN
   ```

3. Verify the pause took effect:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network $NETWORK \
     -- is_paused
   # Expected: true
   ```

4. Record the pause ledger, timestamp, and caller in the incident channel.

5. Update the status page and notify users.

### Rollback

Unpause the contract once the issue is resolved (see §2).

---

## 2. Unpause the contract

**When to use:** The incident is resolved, the fix is verified, and operations are ready to resume.

**Authorized callers:** Admin or treasury recipient.

### Steps

1. Confirm the investigation is complete and documented.

2. Confirm the contract is currently paused:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network $NETWORK \
     -- is_paused
   # Expected: true
   ```

3. Unpause:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network $NETWORK \
     --source-account <admin-or-treasury-secret-key> \
     -- unpause_contract \
       --caller $ADMIN
   ```

4. Verify:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network $NETWORK \
     -- is_paused
   # Expected: false
   ```

5. Re-enable the settlement bot (`AUTO_SETTLE_ENABLED=true`) and confirm it resumes processing expired pools.

6. Close the incident and post a summary in the incident channel.

---

## 3. Rotate the settlement admin (resolver rotation)

**When to use:** The admin key is suspected compromised, a planned key rotation schedule is due, or the key holder is unavailable.

This is a two-step process (`propose_admin` → `accept_admin`). Do **not** use `set_admin` — it takes effect immediately with no confirmation from the new key.

For the full procedure including oracle credential rotation, see [`ORACLE_ROTATION.md`](./ORACLE_ROTATION.md).

**Authorized callers:** Treasury recipient (to propose), new admin key (to accept).

### Steps

1. Stop automatic settlement in the bot: set `AUTO_SETTLE_ENABLED=false` and restart. Wait one `POLL_INTERVAL_MS` and confirm in logs that no settlement transactions are pending.

2. Record the current state:
   ```bash
   stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_admin
   stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_pending_admin
   # Expected: get_pending_admin returns None
   ```

3. Propose the new admin (treasury recipient signs):
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network $NETWORK \
     --source-account <treasury-secret-key> \
     -- propose_admin \
       --caller $TREASURY \
       --new_admin <new-admin-address>
   ```

4. Confirm the proposal is recorded:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network $NETWORK \
     -- get_pending_admin
   # Expected: Some(<new-admin-address>)
   ```

5. Accept from the new key:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network $NETWORK \
     --source-account <new-admin-secret-key> \
     -- accept_admin \
       --caller <new-admin-address>
   ```

6. Verify:
   ```bash
   stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_admin
   # Expected: <new-admin-address>
   stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_pending_admin
   # Expected: None
   ```

7. Update the bot with the new key (`BOT_SECRET_KEY=<new-key>`, `DRY_RUN=true`) and confirm dry-run settlement logs show the new address. Then set `DRY_RUN=false` and `AUTO_SETTLE_ENABLED=true`.

8. Revoke/archive the old key in the secrets manager.

### Rollback

If the new key turns out to be incorrect, the new admin (now holding authority) must propose and accept again with the correct key. There is no way to cancel a pending proposal other than completing it.

---

## 4. Handle a stuck market (stuck-market resolution)

**When to use:** A pool's expiry has passed but it has not been settled, the settlement bot is unable to process it, or `settle_pool` is failing for a specific pool.

### Steps

1. Identify the stuck pool:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network $NETWORK \
     -- get_pool <pool-id>
   # Look for: expired == true, settled == false, status == Open
   ```

2. Check the bot logs for the specific pool ID. Common causes:
   - Oracle source is unavailable or returning stale data.
   - `PoolIsFrozen` (16) — pool was frozen before expiry.
   - The bot's `AUTO_SETTLE_ENABLED` is `false`.
   - RPC timeouts causing the settlement transaction to fail.

3. If the oracle is unavailable and you have the winning outcome from an alternative source, settle manually using the admin key:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network $NETWORK \
     --source-account <admin-secret-key> \
     -- settle_pool \
       --caller $ADMIN \
       --pool_id <pool-id> \
       --winning_outcome <outcome-index>
   ```

4. If the pool is frozen, unfreeze it first (see §5), then settle.

5. Verify the pool is now settled:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network $NETWORK \
     -- get_pool <pool-id>
   # Expected: settled == true
   ```

6. If the pool should be cancelled instead of settled (e.g., the event was abandoned), void it. Voiding is only valid for `Open` pools:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network $NETWORK \
     --source-account <admin-secret-key> \
     -- void_pool \
       --caller $ADMIN \
       --pool_id <pool-id>
   ```

### Rollback

A settled pool cannot be re-settled. If the wrong outcome was declared, the pool must remain as-is or be escalated to a governance action or contract upgrade. This is not recoverable at the operator level.

---

## 5. Freeze and unfreeze a pool

**When to use:** A specific pool needs to be suspended — for example, there is a dispute about the outcome, the event data is disputed, or there is suspicious activity in a single pool without a need to pause the whole contract.

**Authorized callers:** Freeze admin.

### Freeze

```bash
stellar contract invoke \
  --id $CONTRACT_ID --network $NETWORK \
  --source-account <freeze-admin-secret-key> \
  -- freeze_pool \
    --caller $FREEZE_ADMIN \
    --pool_id <pool-id>
```

**Verify:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID --network $NETWORK \
  -- get_pool <pool-id>
# Expected: status includes Frozen / PoolIsFrozen
```

### Unfreeze

```bash
stellar contract invoke \
  --id $CONTRACT_ID --network $NETWORK \
  --source-account <freeze-admin-secret-key> \
  -- unfreeze_pool \
    --caller $FREEZE_ADMIN \
    --pool_id <pool-id>
```

**Verify:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID --network $NETWORK \
  -- get_pool <pool-id>
# Expected: pool returns to its pre-freeze status
```

### Rollback

Unfreeze with the same command as above. The pool resumes from its pre-freeze state.

---

## 6. Verification commands reference

Use these read-only commands to record state before making any change and to verify state after.

```bash
# Contract health
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- is_paused
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_admin
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_treasury_recipient
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_freeze_admin
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_pending_admin
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_dispute_window
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_stale_oracle_threshold

# Fee state
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_fee_config
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_creation_fee
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_max_protocol_fee_bps
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_treasury_balance

# Pool state
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_pool <pool-id>
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_pool_payout_state --pool_id <pool-id>
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_resolution_deadline --pool_id <pool-id>
```

---

## 7. Using placeholders

All commands above use placeholder values (`C...`, `G...`, `<pool-id>`, `<admin-secret-key>`, etc.). Before running any command in production:

1. Replace every `C...` with the actual contract address from your deployment record.
2. Replace every `G...` with the actual Stellar public key from your secrets manager.
3. Replace `<...-secret-key>` with the path or reference to the secret in your secrets manager. **Never copy secret keys into this document or the incident channel.**
4. Confirm `NETWORK` matches your target (`mainnet` or `testnet`).

---

## 8. Related documents

- [`INCIDENT_RUNBOOK.md`](./INCIDENT_RUNBOOK.md) — severity levels, escalation, and first-five-minutes checklist
- [`PAUSED_CONTRACT_RUNBOOK.md`](./PAUSED_CONTRACT_RUNBOOK.md) — detailed pause/unpause scenarios
- [`ORACLE_ROTATION.md`](./ORACLE_ROTATION.md) — full oracle and admin key rotation procedure
- [`MARKET_LIFECYCLE.md`](./MARKET_LIFECYCLE.md) — pool states and transition rules
- [`OPS_TOOLS.md`](./OPS_TOOLS.md) — operational tooling and monitoring commands
- [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) — deployment and rollback procedures
