# Predinex Operations Runbook

This runbook covers deployment, monitoring, incident response, and emergency procedures for the Predinex prediction market contract and associated infrastructure.

---

## Part 1: Deployment Procedures

### Prerequisites

- Stellar CLI installed and configured
- Rust toolchain with `wasm32-unknown-unknown` target
- Admin and deployer keys in secure storage (hardware wallet or sealed vault)
- Access to Vercel deployment settings (for web frontend)
- Monitoring and alerting configured (Sentry, ValidationCloud)

### Testnet Deployment

#### Step 1: Build the Contract

```bash
cd contracts/predinex
cargo build --target wasm32-unknown-unknown --release
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/predinex.wasm
```

Verify the optimized WASM:
```bash
ls -lh target/wasm32-unknown-unknown/release/predinex.optimized.wasm
```

#### Step 2: Deploy to Testnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/predinex.optimized.wasm \
  --source admin \
  --network testnet
```

**Output:** The command returns a `CONTRACT_ID`. Save this in a secure location or environment variable:
```bash
export TESTNET_CONTRACT_ID="CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX..."
echo $TESTNET_CONTRACT_ID
```

#### Step 3: Initialize the Contract

```bash
stellar contract invoke \
  --id $TESTNET_CONTRACT_ID \
  --source admin \
  --network testnet \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --treasury_recipient <TREASURY_ADDRESS>
```

### Testnet Verification

#### Verify Contract ID

Confirm the deployed contract address:
```bash
stellar contract info \
  --id $TESTNET_CONTRACT_ID \
  --network testnet
```

#### Verify SAC (Stellar Asset Contract)

Ensure the underlying token is properly configured:
```bash
stellar contract invoke \
  --id $TESTNET_CONTRACT_ID \
  --source admin \
  --network testnet \
  -- get_token
```

Expected output: SAC address for the configured token (e.g., USDC).

#### Frontend Configuration Check

Update `web/.env.local` (or Vercel secrets):
```
NEXT_PUBLIC_SOROBAN_CONTRACT_ID=<TESTNET_CONTRACT_ID>
NEXT_PUBLIC_SOROBAN_NETWORK=testnet
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

Verify in the frontend by checking `/api/config` response:
```bash
curl https://<testnet-frontend-url>/api/config
```

### Mainnet Deployment Checklist

Complete **all items** before proceeding:

- [ ] **Code review**: Two senior team members reviewed all contract changes
- [ ] **Testnet validation**: All features tested on testnet for minimum 48 hours
- [ ] **Security audit**: Contract passed external audit (if applicable)
- [ ] **Backup keys**: Admin and treasury keys backed up in hardware wallet + secure vault
- [ ] **Multi-sig**: Admin account requires M-of-N signatures (recommend 2-of-3)
- [ ] **Monitoring active**: Sentry, ValidationCloud, and dashboard alerts configured
- [ ] **Communication plan**: Incident response team identified and on standby
- [ ] **Rollback plan**: Previous contract WASM hash and deployment procedure documented
- [ ] **Dry-run**: Exact mainnet steps executed on testnet successfully
- [ ] **Funding verified**: Contract wallet has sufficient XLM for operations
- [ ] **Web frontend ready**: Mainnet environment tested and staged

### Mainnet Deployment Steps

1. **Build & Verify Contract**
   ```bash
   cd contracts/predinex
   cargo build --target wasm32-unknown-unknown --release
   stellar contract optimize --wasm target/wasm32-unknown-unknown/release/predinex.wasm
   
   # Compute WASM hash for verification (see bytecode verification workflow)
   sha256sum target/wasm32-unknown-unknown/release/predinex.optimized.wasm
   ```

2. **Deploy with Multi-Sig**
   ```bash
   stellar contract deploy \
     --wasm target/wasm32-unknown-unknown/release/predinex.optimized.wasm \
     --source admin-multisig \
     --network mainnet
   ```

3. **Record Contract ID**
   ```bash
   export MAINNET_CONTRACT_ID="<returned-contract-id>"
   
   # Verify bytecode matches audited hash
   stellar contract fetch --id $MAINNET_CONTRACT_ID --network mainnet \
     > /tmp/mainnet.wasm
   sha256sum /tmp/mainnet.wasm  # Should match pre-deployment hash
   ```

4. **Initialize Contract**
   ```bash
   stellar contract invoke \
     --id $MAINNET_CONTRACT_ID \
     --source admin-multisig \
     --network mainnet \
     -- initialize \
     --admin <MAINNET_ADMIN_ADDRESS> \
     --treasury_recipient <MAINNET_TREASURY_ADDRESS>
   ```

5. **Update Frontend Environment**
   ```bash
   # Update Vercel secrets
   vercel env add NEXT_PUBLIC_SOROBAN_CONTRACT_ID=$MAINNET_CONTRACT_ID --prod
   ```

6. **Smoke Test**
   - Create a small test pool via UI
   - Place small bets from multiple accounts
   - Verify events appear in explorer
   - Check dashboard displays pools correctly

7. **Gradual Rollout**
   - Day 1: Announce maintenance window, direct users to testnet
   - Hour 1: Deploy frontend update (no contract change)
   - Hour 2: Deploy contract, run smoke tests
   - Hour 4+: Monitor dashboard, watch error tracking
   - Day 2: Resume normal operations if stable

---

## Part 2: Monitoring Runbook

### Key Metrics to Track

#### Transaction Health

| Metric | Normal Range | Alert Threshold | Check Interval |
|--------|--------------|-----------------|-----------------|
| Create pool success rate | >99% | <98% | 5 minutes |
| Place bet success rate | >99% | <98% | 5 minutes |
| Settlement success rate | >99% | <98% | 5 minutes |
| Average block latency | <10s | >30s | 5 minutes |
| Fee simulation accuracy | Within 5% | >10% variance | 1 hour |

#### Pool Activity

| Metric | Description | Alert When |
|--------|-------------|-----------|
| Active pools | Number of open, unsettled pools | >1000 (circuit breaker) |
| 24h volume | Sum of all bets in last 24 hours | Unusual spike (2x baseline) |
| Avg pool duration | Mean time from creation to settlement | <1 min or >30 days |
| Settlement lag | Avg delay between pool expiry and settlement | >24 hours |
| Unclaimed winnings | Total payout still pending claim | >50% of settled pools |

#### Protocol Health

| Metric | Description | Alert When |
|--------|-------------|-----------|
| Protocol fee collected | Running total of treasury fees | Drops >50% month-over-month |
| Participant count | Avg bettors per pool | <2 (no market) |
| Win/loss distribution | Pool outcome probabilities | Skewed >90/10 |
| Rate limit triggers | Wallets hitting rate limit | >5% of active users |
| Disputed pools | Pools with active disputes | Any pool over 7 days |

#### System Health

| Metric | Description | Alert When |
|--------|-------------|-----------|
| RPC latency | Time to get_pool response | >2s |
| Event indexing lag | Time behind latest ledger | >5 minutes |
| Storage size | Ledger entry count | >100,000 entries |
| TTL extensions | Per-day maintenance transactions | >1000 txns/day |
| Gas costs | Avg stroops per transaction | >2x historical average |

### Monitoring Dashboard Setup

#### Real-Time Monitoring (Recommended: Grafana + Prometheus)

1. **Create datasources:**
   - Stellar RPC endpoint (via custom script polling)
   - Event indexer database
   - Error tracking (Sentry)

2. **Set up dashboards:**
   - **Overview:** Active pools, 24h volume, settlement rate
   - **Transactions:** Success rates, latency, error breakdown
   - **Treasury:** Fee collection, withdrawal rate limits
   - **Incidents:** Alert history, dispute count, frozen pools

3. **Configure alerts:**
   ```yaml
   # Example Prometheus alert rules
   - alert: HighFailureRate
     expr: rate(create_pool_failures[5m]) / rate(create_pool_total[5m]) > 0.02
     for: 10m
     labels:
       severity: critical
     annotations:
       summary: "Create pool failure rate >2%"
   
   - alert: LargeVolumeSpike
     expr: increase(place_bet_volume[1h]) > 2 * avg_over_time(place_bet_volume[7d])
     for: 15m
     labels:
       severity: warning
   ```

#### Event Indexing Queries

```sql
-- Active pools by status
SELECT status, COUNT(*) as count
FROM pools
WHERE status IN ('Open', 'Scheduled')
GROUP BY status;

-- 24-hour volume
SELECT SUM(amount) as volume_24h
FROM bets
WHERE timestamp > NOW() - INTERVAL 24 HOUR;

-- Settlement lag (hours)
SELECT AVG(EXTRACT(HOUR FROM (settled_at - expires_at))) as avg_lag_hours
FROM pools
WHERE status = 'Settled' AND settled_at > NOW() - INTERVAL 7 DAY;

-- Unclaimed winnings
SELECT SUM(net_payout - claimed_amount) as unclaimed
FROM pools
WHERE status = 'Settled' AND claimed_amount < net_payout;
```

#### Grafana Dashboards to Configure

1. **Pool Lifecycle Dashboard**
   - Create pool trend (24h, 7d, 30d)
   - Settlement success rate timeline
   - Pool status distribution (pie chart)

2. **Financial Dashboard**
   - Protocol fee revenue trend
   - Treasury balance history
   - Fee tier utilization

3. **User Activity Dashboard**
   - Daily active wallets
   - Bet frequency distribution
   - Win/loss distribution by outcome

### Monitoring Cadence

| Time Period | Check | Owner |
|-------------|-------|-------|
| Every 5 min | Transaction success rates, RPC latency | On-call (automated alert) |
| Hourly | Fee estimation accuracy, active pool count | On-call |
| Daily | Volume trends, settlement lag, disputes | Operations team |
| Weekly | Participant trends, gas cost analysis | Engineering team |
| Monthly | Protocol health review, TTL extension costs | Engineering + Operations |

---

## Part 3: Incident Response Procedures

### Incident Severity Classification

#### Severity 1: Critical
**Impact:** Funds at risk, contract frozen, settlement failure

**Response time:** Immediate (within 5 minutes)  
**Team:** All on-call, CTO escalation  
**Actions:**
1. Freeze contract and affected pools (`freeze_pool` or `set_paused`)
2. Notify users via emergency banner
3. Begin incident investigation
4. Prepare rollback if necessary

**Examples:**
- Exploit allowing unauthorized fund withdrawal
- Settlement producing negative payouts
- Mass contract panic due to bug report

#### Severity 2: High
**Impact:** Feature unavailable, degraded performance, data inconsistency

**Response time:** 30 minutes  
**Team:** Engineering lead + on-call  
**Actions:**
1. Identify root cause
2. Determine if workaround exists
3. Begin fix or rollback process
4. Communicate status to users

**Examples:**
- Cannot create pools (validation error in contract)
- Betting disabled but settlement works
- Event indexing 1+ hour behind

#### Severity 3: Medium
**Impact:** Minor feature degradation, cosmetic issues, warnings in logs

**Response time:** 4 hours  
**Team:** Engineering team during business hours  
**Actions:**
1. Schedule fix in next release
2. Monitor for escalation
3. Document workaround if applicable

**Examples:**
- Rate limiting too strict (80% of users affected)
- Metadata URIs not loading (non-critical data)
- RPC latency elevated but acceptable

### Incident Response Workflow

#### Phase 1: Detection & Triage (First 5 minutes)

```
Alert Received
     ↓
Verify Alert (Test in staging)
     ↓
Classify Severity
     ↓
Gather Initial Data
  - Contract state
  - Recent events
  - User reports
  - RPC status
     ↓
→ To Phase 2
```

**Key commands:**
```bash
# Check contract pause status
stellar contract invoke --id $CONTRACT_ID --network mainnet \
  -- is_paused

# Check recent events
soroban-rpc-client get_events --contract-id $CONTRACT_ID --limit 100

# Check treasury balance
stellar contract invoke --id $CONTRACT_ID --network mainnet \
  -- get_treasury

# Verify RPC connectivity
soroban-rpc-client health-check
```

#### Phase 2: Mitigation (5-30 minutes)

**For financial threats:**
```bash
# Freeze entire contract
stellar contract invoke --id $CONTRACT_ID \
  --source freeze_admin --network mainnet \
  -- set_paused --paused true

# Freeze specific pool
stellar contract invoke --id $CONTRACT_ID \
  --source freeze_admin --network mainnet \
  -- freeze_pool --pool_id <ID>
```

**For indexing issues:**
```bash
# Skip to latest ledger
soroban-rpc-client catchup-indexer --ledger <latest>

# Clear event cache and rescan
DELETE FROM events WHERE timestamp > <issue-start>;
-- Reindex from Stellar ledger
```

**For performance issues:**
```bash
# Scale RPC endpoints
# (Depends on provider: ValidationCloud, Stellar public RPC, etc.)
# Contact provider for urgent scaling

# Reduce client-side polling if applicable
# Deploy frontend hotfix to reduce request rate
```

#### Phase 3: Root Cause Analysis (During incident + 24 hours after)

1. **Timeline:** Reconstruct exact sequence of events
   ```bash
   # Query event log
   SELECT timestamp, event_type, data FROM events
   WHERE timestamp > <incident-start>
   ORDER BY timestamp;
   ```

2. **Data validation:** Check for inconsistencies
   ```bash
   # Verify pool totals match bet sums
   SELECT pool_id, 
          (SELECT SUM(amount) FROM bets WHERE pool_id = pools.id) as bet_sum,
          total_a + total_b as stored_total
   FROM pools
   WHERE ABS(bet_sum - stored_total) > 1;
   ```

3. **Code review:** Identify the bug
   - Compare deployment version against source
   - Review recent commits
   - Check contract state migrations

4. **Reproduce:** Confirm fix in testnet
   - Apply fix to testnet contract
   - Replicate incident scenario
   - Verify no side effects

#### Phase 4: Communication

**Escalation chain:**
1. **5 min:** Notify on-call slack channel #incidents
2. **15 min:** Update status.predinex.io with incident page
3. **30 min:** Email all users with impact assessment + ETA
4. **Resolved:** Post-mortem summary and remediation plan

**Sample incident page:**
```
INCIDENT: Create Pool Validation Error
Started: 2025-01-15 14:23 UTC
Status: INVESTIGATING

Impact: Users cannot create new pools. Existing pools unaffected.

Workaround: None at this time. Check back in 30 minutes.

Updates:
14:25 - Contract paused to prevent new errors
14:35 - Root cause identified: validation regex bug
14:45 - Fix tested on testnet successfully
14:50 - Deploying fix to mainnet
15:00 - RESOLVED - New pools working again
```

### Common Incidents & Resolution

#### Cannot Create Pools

**Diagnosis:**
```sql
-- Check for validation errors in event log
SELECT error_message, COUNT(*) FROM contract_errors
WHERE timestamp > NOW() - INTERVAL 1 HOUR
GROUP BY error_message;
```

**Resolution:**
- If validation issue: Deploy contract fix
- If state corruption: Investigate initialization
- If rate limiting: Increase rate limit threshold
- Workaround: None (requires contract update)

#### Settlement Produces Incorrect Payouts

**Diagnosis:**
```sql
-- Verify payout math
SELECT pool_id, winning_outcome, 
       winning_total, losing_total,
       fee_amount, payout_per_winner
FROM pools WHERE id = <affected_pool>;

-- Cross-check with claim events
SELECT SUM(amount) FROM claims WHERE pool_id = <affected_pool>;
```

**Resolution:**
- Freeze pool immediately (`freeze_pool`)
- Audit all claims from this pool
- Calculate corrected amount owed to each winner
- Deploy contract fix or manual adjustment transaction
- Redeploy with fix before unfreezing

#### Event Indexing Lagging >5 Minutes

**Diagnosis:**
```bash
# Check indexer cursor vs. ledger tip
soroban-rpc-client get_latest_ledger  # Current ledger
soroban-rpc-client get_indexed_ledger  # Indexed up to

# Check indexer service logs
kubectl logs deployment/soroban-indexer -f
```

**Resolution:**
- Increase indexer worker threads (if available)
- Clear event cache and rescan from known good point
- Contact RPC provider for infrastructure scaling
- Fall back to polling contract state if indexing critical

#### Users Cannot Claim Winnings

**Diagnosis:**
```bash
# Try a test claim from contract
stellar contract invoke --id $CONTRACT_ID --source testuser \
  --network mainnet \
  -- claim_winnings --pool_id <ID>
  
# Check for SAC (token contract) issues
stellar contract info --id <SAC_ADDRESS> --network mainnet
```

**Resolution:**
- If SAC issue: Contact Stellar support (external)
- If contract issue: Deploy fix to claim logic
- If rate limiting: Batch claims or increase limits
- If TTL: Bump storage TTL for affected pool

---

## Part 4: Database & State Management

### Backup Procedures

#### Before Each Mainnet Deployment

1. **Export contract state:**
   ```bash
   # Fetch all pools
   stellar contract invoke --id $CONTRACT_ID --network mainnet \
     -- get_pools --start_id 0 --count 10000 \
     > /backup/pools_$(date +%Y%m%d_%H%M%S).json
   
   # Fetch treasury state
   stellar contract invoke --id $CONTRACT_ID --network mainnet \
     -- get_treasury > /backup/treasury_$(date +%Y%m%d_%H%M%S).json
   ```

2. **Export indexer database:**
   ```bash
   # Dump to local file
   pg_dump -U postgres predinex_indexer \
     | gzip > /backup/indexer_$(date +%Y%m%d_%H%M%S).sql.gz
   
   # Verify backup size
   ls -lh /backup/
   ```

3. **Verify backups are recoverable:**
   ```bash
   # Test database restore
   gunzip < /backup/indexer_latest.sql.gz | psql -U postgres predinex_test
   ```

4. **Upload to secure storage:**
   ```bash
   # AWS S3 (encrypted)
   aws s3 cp /backup/ s3://predinex-backups-encrypted/ \
     --sse AES256 --recursive
   
   # Verify upload
   aws s3 ls s3://predinex-backups-encrypted/
   ```

#### Automatic Daily Backups

```yaml
# Kubernetes CronJob
apiVersion: batch/v1
kind: CronJob
metadata:
  name: predinex-backup
spec:
  schedule: "0 2 * * *"  # 2am UTC daily
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: postgres:16
            command:
            - /bin/sh
            - -c
            - |
              pg_dump $DATABASE_URL | gzip | \
              aws s3 cp - s3://predinex-backups/daily-$(date +%Y%m%d).sql.gz --sse AES256
            env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: predinex-db
                  key: url
```

### Data Recovery

#### Recover from Database Backup

```bash
# 1. Identify backup point
ls -lh /backup/ | grep -i predinex

# 2. Stop indexer (prevent new writes during recovery)
kubectl scale deployment soroban-indexer --replicas=0

# 3. Restore database
gunzip < /backup/indexer_2025-01-15_120000.sql.gz | psql $DATABASE_URL

# 4. Verify recovery
psql $DATABASE_URL -c "SELECT COUNT(*) FROM pools;"
psql $DATABASE_URL -c "SELECT MAX(indexed_ledger) FROM indexer_state;"

# 5. Restart indexer to catch up
kubectl scale deployment soroban-indexer --replicas=1
```

#### Sync Indexer with Contract State

If indexer is permanently corrupted:

```bash
# 1. Clear all indexed data
psql $DATABASE_URL -c "TRUNCATE TABLE bets, pools, claims CASCADE;"

# 2. Fetch contract state snapshot
stellar contract invoke --id $CONTRACT_ID --network mainnet \
  -- get_pools --start_id 0 --count 10000 > /tmp/pools.json

# 3. Reconstruct from events
soroban-rpc-client get_events \
  --contract-id $CONTRACT_ID \
  --start-ledger 0 \
  --limit 100000 > /tmp/events.json

# 4. Replay events to rebuild state
python3 scripts/replay_events.py /tmp/events.json

# 5. Verify consistency
./scripts/verify_indexer_consistency.sh
```

#### State Recovery After Contract Upgrade

If a contract upgrade introduces state schema changes:

```bash
# 1. Verify old contract still responds
stellar contract invoke --id $OLD_CONTRACT_ID --network mainnet \
  -- get_pools --start_id 0 --count 10 

# 2. Migrate data if needed
python3 scripts/migrate_state.py \
  --old-contract $OLD_CONTRACT_ID \
  --new-contract $NEW_CONTRACT_ID \
  --network mainnet

# 3. Run verification tests
cargo test --test integration_tests -- --nocapture
```

---

## Part 5: Key Management Procedures

### Admin Key Hierarchy

```
Master Admin (Hardware Wallet - OFFLINE)
    ├── Mainnet Admin (Multi-Sig 2-of-3)
    │   ├── Admin Key 1 (Vault)
    │   ├── Admin Key 2 (Vault)
    │   └── Admin Key 3 (Backup, Offline)
    ├── Testnet Admin (Single sig for testing)
    └── Deploy Key (CI/CD - Limited scope)
```

### Key Rotation Schedule

| Key Type | Rotation Interval | Process | Owner |
|----------|-------------------|---------|-------|
| Deploy key (CI/CD) | Every 30 days | Regenerate in GitHub secrets | DevOps |
| Testnet admin | Every 90 days | New testnet deployment | Engineering |
| Mainnet multi-sig signers | Every 180 days | Replace 1 signer at a time | Security team |
| Treasury key | Never (audit trail) | Keep offline backup only | CFO |
| Freeze admin key | Every 90 days | New account, revoke old | Security team |

### Key Storage

**Master Admin (Hardware Wallet):**
- Device: Ledger Nano X or equivalent
- Location: Physical vault (bank/office safe)
- Access: Requires 2 senior team members
- Backup: Seed phrase in sealed envelope, stored separately

**Mainnet Multi-Sig Keys:**
- Location A: Vault (encrypted private key file)
- Location B: AWS KMS (encrypted, access-controlled)
- Location C: Offline backup (paper backup in safe)
- Passwords: Shared via separate secure channels

**Testnet Admin:**
- Storage: Encrypted file in GitHub secrets
- Rotation: Automatic via CI/CD pipeline every 30 days
- Scope: Testnet only, no mainnet access

**Deploy Key:**
- Storage: GitHub secrets + AWS Secrets Manager
- Rotation: Automatic every 30 days
- Scope: Limited to contract deploy action only

### Emergency Key Recovery

If mainnet admin key is lost/compromised:

1. **Immediate response:**
   - Pause contract: `set_paused(true)` from any remaining key
   - Notify all stakeholders
   - Initiate incident response

2. **Prepare recovery transaction:**
   - Use master admin key (hardware wallet)
   - Update all admin/settler roles to new key
   - `set_freeze_admin` to known address

3. **Execute recovery:**
   - Sign transaction with 2+ multi-sig keys
   - Broadcast to network
   - Verify transaction success

4. **Communication:**
   - Post incident report
   - Update key management procedures
   - Schedule key rotation for all related keys

---

## Part 6: Emergency Procedures

### Contract Pause (Emergency Stop)

**When to use:** Any critical issue requiring immediate user action halt

```bash
# Pause contract (no bets, no claims, no new pools)
stellar contract invoke --id $CONTRACT_ID \
  --source freeze_admin --network mainnet \
  -- set_paused --paused true

# Resume contract
stellar contract invoke --id $CONTRACT_ID \
  --source freeze_admin --network mainnet \
  -- set_paused --paused false
```

**Effects:**
- ✅ No new pools can be created
- ✅ No new bets can be placed
- ✅ No claims processed
- ❌ Existing pools cannot be modified
- ❌ Settled pools cannot be claimed

**Recovery:** Deploy fixed contract or `set_paused(false)`

### Pool Freeze (Targeted Stop)

**When to use:** Specific pool has incorrect state or disputed settlement

```bash
# Freeze pool (no further state changes)
stellar contract invoke --id $CONTRACT_ID \
  --source freeze_admin --network mainnet \
  -- freeze_pool --pool_id <ID>

# Dispute frozen pool (extend freeze until resolution)
stellar contract invoke --id $CONTRACT_ID \
  --source <user> --network mainnet \
  -- dispute_pool --pool_id <ID>

# Unfreeze pool (after dispute resolved)
stellar contract invoke --id $CONTRACT_ID \
  --source freeze_admin --network mainnet \
  -- unfreeze_pool --pool_id <ID>
```

### Void Pool (Refund All Bettors)

**When to use:** Pool is cancelled, disputed unresolvably, or contract bug affected outcome

```bash
stellar contract invoke --id $CONTRACT_ID \
  --source admin --network mainnet \
  -- void_pool --pool_id <ID>
```

**Effects:**
- ✅ All bettors can claim full refunds
- ❌ Creator does not receive pool creation fee back
- ❌ Settlement is cancelled

### Upgrade Contract (Replace with Fixed Version)

**When to use:** Critical bug requires code change

1. **Prepare upgrade:**
   ```bash
   # Build new version
   cargo build --release --target wasm32-unknown-unknown
   
   # Compute hash for verification
   sha256sum target/wasm32-unknown-unknown/release/predinex.optimized.wasm
   
   # Test on testnet
   stellar contract deploy --wasm ... --network testnet
   ```

2. **Backup current state:**
   ```bash
   stellar contract invoke --id $CONTRACT_ID --network mainnet \
     -- get_pools --start_id 0 --count 10000 > /backup/pools_before_upgrade.json
   ```

3. **Deploy upgraded contract:**
   ```bash
   stellar contract deploy \
     --wasm target/wasm32-unknown-unknown/release/predinex.optimized.wasm \
     --source admin-multisig --network mainnet
   
   export NEW_CONTRACT_ID=<result>
   ```

4. **Migrate state (if needed):**
   ```bash
   # If contract storage schema changed:
   python3 scripts/migrate_pools.py \
     --old-contract $CONTRACT_ID \
     --new-contract $NEW_CONTRACT_ID
   ```

5. **Verify upgrade:**
   ```bash
   stellar contract invoke --id $NEW_CONTRACT_ID --network mainnet \
     -- get_pool_count

   # Compare pools match
   stellar contract invoke --id $NEW_CONTRACT_ID --network mainnet \
     -- get_pools --start_id 0 --count 10 > /tmp/pools_after.json
   ```

6. **Switch frontend:**
   ```bash
   # Update contract ID in environment
   vercel env add NEXT_PUBLIC_SOROBAN_CONTRACT_ID=$NEW_CONTRACT_ID --prod
   ```

### Fund Recovery (After Exploit)

**When to use:** Attacker stole funds or drained treasury

1. **Immediate containment:**
   - Freeze contract: `set_paused(true)`
   - Identify affected pools/users
   - Estimate total loss

2. **Calculate refunds:**
   ```sql
   -- Find all bets on affected pool
   SELECT user, SUM(amount) as user_total
   FROM bets
   WHERE pool_id = <affected_pool>
   GROUP BY user;
   ```

3. **Execute recovery transaction:**
   ```bash
   # Manual transfer if SAC allows admin recovery
   stellar contract invoke --id $SAC_ADDRESS \
     --source treasury --network mainnet \
     -- transfer \
     --from treasury \
     --to <affected_user> \
     --amount <refund_amount>
   ```

4. **Alternatively, redeploy upgraded contract:**
   - Upgrade contract with new logic if exploit found
   - New contract pre-populates user balances
   - Migrate to new contract

5. **Post-recovery:**
   - Publish detailed incident report
   - Announce audit timeline
   - Provide compensation if necessary

---

## Runbook Maintenance

### Update Schedule
- **Monthly:** Review incident logs, update procedures if needed
- **Quarterly:** Test backup/restore procedures
- **Quarterly:** Run disaster recovery drill
- **Annual:** Full security audit and penetration testing

### Document Ownership
- Deployment: Tech lead
- Monitoring: DevOps team
- Incident response: CTO + On-call rotation
- Database: Database administrator
- Key management: Security team
- Emergency: CTO on-call

### Contacts & Escalation

```
Level 1 (Automated): Monitoring alerts → #incidents channel
Level 2 (On-call): Engineering lead → Slack + phone
Level 3 (Critical): CTO → All-hands + external stakeholders
Level 4 (Exploit): CEO → Legal + Investors + Authorities
```

---

## Appendix: Useful Commands

```bash
# Get contract info
stellar contract info --id $CONTRACT_ID --network mainnet

# Query pool state
stellar contract invoke --id $CONTRACT_ID --source admin --network mainnet \
  -- get_pool --pool_id <ID>

# Check treasury balance
stellar contract invoke --id $CONTRACT_ID --source admin --network mainnet \
  -- get_treasury

# View recent events
soroban-rpc-client get_events \
  --contract-id $CONTRACT_ID \
  --start-ledger $(soroban-rpc-client get_latest_ledger | jq .ledger - 1000) \
  --limit 100

# Monitor ongoing transactions
stellar transactions --account admin --network mainnet --streaming

# Check current fee stats
stellar contract invoke --id $CONTRACT_ID --source admin --network mainnet \
  -- get_protocol_fee
```

---

**Last Updated:** 2025-01-15  
**Next Review:** 2025-02-15  
**Maintained by:** Operations Team

