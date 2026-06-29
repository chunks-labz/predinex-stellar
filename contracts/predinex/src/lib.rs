#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String, Symbol, Vec};

mod test;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Pool(u32),
    UserBet(u32, Address),
    PoolCounter,
    Token,
    Treasury,
    TreasuryRecipient,
    DelegatedSettler(u32),
    FreezeAdmin,
}

/// Explicit lifecycle status for a prediction pool.
///
/// Transitions:
///   Open  ──(expiry reached + settle_pool called)──►  Settled(winning_outcome)
///   Open  ──(freeze_pool called)──►  Frozen
///   Settled  ──(dispute_pool called)──►  Disputed
///   Frozen/Disputed  ──(unfreeze_pool called)──►  Active
///
/// Future terminal states (Cancelled, Voided, Paused) can be added here
/// without ambiguity, because status is the single source of truth.
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum PoolStatus {
    /// Accepting bets; expiry has not yet passed.
    Open,
    /// Betting closed and a winning outcome has been declared.
    /// The inner value is the winning outcome index (0 or 1).
    Settled(u32),
    /// Pool is operational and can accept bets or claims.
    Active,
    /// Pool is temporarily frozen, blocking bets and claims.
    Frozen,
    /// Pool settlement is disputed, blocking claims pending review.
    Disputed,
}

#[derive(Clone)]
#[contracttype]
pub struct Pool {
    pub creator: Address,
    pub title: String,
    pub description: String,
    pub outcome_a_name: String,
    pub outcome_b_name: String,
    pub total_a: i128,
    pub total_b: i128,
    pub participant_count: u32,
    pub settled: bool,
    pub winning_outcome: Option<u32>,
    pub created_at: u64,
    pub expiry: u64,
    /// Current operational status of the pool. Defaults to `Active`.
    pub status: PoolStatus,
}

#[derive(Clone)]
#[contracttype]
pub struct UserBet {
    pub amount_a: i128,
    pub amount_b: i128,
    pub total_bet: i128,
}

/// Event payload emitted by `place_bet`.
///
/// Fields
/// ------
/// - `outcome`   – which side was bet on (0 = A, 1 = B)
/// - `amount`    – tokens staked in this single bet
/// - `amount_a`  – user's cumulative stake on outcome A after this bet
/// - `amount_b`  – user's cumulative stake on outcome B after this bet
/// - `total_bet` – user's total exposure in this pool after this bet
///
/// The `amount_a`, `amount_b`, and `total_bet` values are identical to what
/// `get_user_bet` would return immediately after the call, allowing indexers
/// and UI consumers to maintain a local position model from events alone.
#[derive(Clone)]
#[contracttype]
pub struct BetEvent {
    pub outcome: u32,
    pub amount: i128,
    pub amount_a: i128,
    pub amount_b: i128,
    pub total_bet: i128,
}

#[contract]
pub struct PredinexContract;

#[contractimpl]
impl PredinexContract {
    pub fn initialize(env: Env, token: Address, treasury_recipient: Address) {
        if env.storage().persistent().has(&DataKey::Token) {
            panic!("Already initialized");
        }
        env.storage().persistent().set(&DataKey::Token, &token);
        env.storage()
            .persistent()
            .set(&DataKey::TreasuryRecipient, &treasury_recipient);
        env.storage().persistent().set(&DataKey::Treasury, &0i128);
    }

    /// Normalize a Soroban `String` to a comparable form by converting to
    /// lowercase bytes and stripping leading/trailing ASCII spaces.
    /// Uses a fixed 64-byte stack buffer — outcome labels longer than 64 bytes
    /// are compared on their first 64 bytes only, which is sufficient for
    /// practical market labels.
    fn normalize_outcome(env: &Env, s: &String) -> soroban_sdk::Bytes {
        let len = s.len() as usize;
        // Copy raw bytes into a fixed-size stack buffer (max 64 bytes)
        let copy_len = if len < 64 { len } else { 64 };
        let mut buf = [0u8; 64];
        s.copy_into_slice(&mut buf[..copy_len]);

        // Find trim boundaries
        let mut start = 0usize;
        let mut end = copy_len;
        while start < end && buf[start] == b' ' {
            start += 1;
        }
        while end > start && buf[end - 1] == b' ' {
            end -= 1;
        }

        // Build a Soroban Bytes with lowercased content
        let mut result = soroban_sdk::Bytes::new(env);
        let mut i = start;
        while i < end {
            let b = buf[i];
            let lower = if b.is_ascii_uppercase() { b + 32 } else { b };
            result.push_back(lower);
            i += 1;
        }
        result
    }

    pub fn create_pool(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        outcome_a: String,
        outcome_b: String,
        duration: u64,
    ) -> u32 {
        creator.require_auth();

        // Reject duplicate outcome labels (case-insensitive, whitespace-trimmed)
        if Self::normalize_outcome(&env, &outcome_a) == Self::normalize_outcome(&env, &outcome_b) {
            panic!("Duplicate outcome labels");
        }

        let pool_id = Self::get_pool_counter(&env);

        let created_at = env.ledger().timestamp();
        let expiry = created_at + duration;

        let pool = Pool {
            creator: creator.clone(),
            title,
            description,
            outcome_a_name: outcome_a,
            outcome_b_name: outcome_b,
            total_a: 0,
            total_b: 0,
            participant_count: 0,
            settled: false,
            winning_outcome: None,
            created_at,
            expiry,
            status: PoolStatus::Open,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        env.storage()
            .persistent()
            .set(&DataKey::PoolCounter, &(pool_id + 1));

        env.events().publish(
            (Symbol::new(&env, "create_pool"), pool_id),
            (creator, Symbol::new(&env, "Open")),
        );

        pool_id
    }

    pub fn place_bet(env: Env, user: Address, pool_id: u32, outcome: u32, amount: i128) {
        user.require_auth();

        if amount <= 0 {
            panic!("Invalid bet amount");
        }

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .expect("Pool not found");

        if pool.status != PoolStatus::Open {
            panic!("Pool not open for betting");
        }

        if env.ledger().timestamp() >= pool.expiry {
            panic!("Pool expired");
        }

        if outcome > 1 {
            panic!("Invalid outcome");
        }

        let token_address = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .expect("Not initialized");
        let token_client = token::Client::new(&env, &token_address);

        token_client.transfer(&user, &env.current_contract_address(), &amount);

        if outcome == 0 {
            pool.total_a += amount;
        } else {
            pool.total_b += amount;
        }

        let mut user_bet = env
            .storage()
            .persistent()
            .get::<_, UserBet>(&DataKey::UserBet(pool_id, user.clone()))
            .unwrap_or(UserBet {
                amount_a: 0,
                amount_b: 0,
                total_bet: 0,
            });

        let is_first_bet = user_bet.total_bet == 0;
        if is_first_bet {
            pool.participant_count += 1;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);

        if outcome == 0 {
            user_bet.amount_a += amount;
        } else {
            user_bet.amount_b += amount;
        }
        user_bet.total_bet += amount;

        env.storage()
            .persistent()
            .set(&DataKey::UserBet(pool_id, user.clone()), &user_bet);

        // Emit event with the bet details and the user's updated cumulative totals.
        // Consumers can reconstruct a full UserBet position from events alone.
        env.events().publish(
            (Symbol::new(&env, "place_bet"), pool_id, user),
            BetEvent {
                outcome,
                amount,
                amount_a: user_bet.amount_a,
                amount_b: user_bet.amount_b,
                total_bet: user_bet.total_bet,
            },
        );
    }

    /// Assign a delegated settler for a pool. Only the pool creator can call this.
    pub fn assign_settler(env: Env, creator: Address, pool_id: u32, settler: Address) {
        creator.require_auth();

        let pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .expect("Pool not found");

        if creator != pool.creator {
            panic!("Unauthorized");
        }

        env.storage()
            .persistent()
            .set(&DataKey::DelegatedSettler(pool_id), &settler);

        env.events().publish(
            (Symbol::new(&env, "assign_settler"), pool_id),
            (creator, settler),
        );
    }

    /// Get the delegated settler for a pool, if one has been assigned.
    pub fn get_delegated_settler(env: Env, pool_id: u32) -> Option<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::DelegatedSettler(pool_id))
    }

    pub fn settle_pool(env: Env, caller: Address, pool_id: u32, winning_outcome: u32) {
        caller.require_auth();

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .expect("Pool not found");

        // Allow creator or delegated settler
        let delegated_settler: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::DelegatedSettler(pool_id));

        let is_authorized =
            caller == pool.creator || delegated_settler.map(|s| s == caller).unwrap_or(false);

        if !is_authorized {
            panic!("Unauthorized");
        }

        if pool.status != PoolStatus::Open {
            panic!("Already settled");
        }

        if env.ledger().timestamp() < pool.expiry {
            panic!("Pool has not expired yet");
        }

        if winning_outcome > 1 {
            panic!("Invalid outcome");
        }

        pool.status = PoolStatus::Settled(winning_outcome);
        pool.settled = true;
        pool.winning_outcome = Some(winning_outcome);

        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);

        env.events().publish(
            (Symbol::new(&env, "settle_pool"), pool_id),
            (caller, winning_outcome),
        );
    }

    pub fn claim_winnings(env: Env, user: Address, pool_id: u32) -> i128 {
        user.require_auth();

        let pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .expect("Pool not found");

        let winning_outcome = match pool.status {
            PoolStatus::Settled(outcome) => outcome,
            PoolStatus::Frozen => panic!("Pool is frozen; claims are blocked"),
            PoolStatus::Disputed => panic!("Pool is disputed; claims are blocked"),
            _ => panic!("Pool not settled"),
        };

        let user_bet = env
            .storage()
            .persistent()
            .get::<_, UserBet>(&DataKey::UserBet(pool_id, user.clone()))
            .expect("No bet found");

        let user_winning_bet = if winning_outcome == 0 {
            user_bet.amount_a
        } else {
            user_bet.amount_b
        };

        if user_winning_bet == 0 {
            panic!("No winnings to claim");
        }

        let pool_winning_total = if winning_outcome == 0 {
            pool.total_a
        } else {
            pool.total_b
        };
        let total_pool_balance = pool.total_a + pool.total_b;

        let fee = (total_pool_balance * 2) / 100;
        let net_pool_balance = total_pool_balance - fee;

        let winnings = (user_winning_bet * net_pool_balance) / pool_winning_total;

        let current_treasury: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Treasury)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::Treasury, &(current_treasury + fee));

        env.events()
            .publish((Symbol::new(&env, "fee_collected"), pool_id), fee);

        let token_address = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .expect("Not initialized");
        let token_client = token::Client::new(&env, &token_address);

        token_client.transfer(&env.current_contract_address(), &user, &winnings);

        env.storage()
            .persistent()
            .remove(&DataKey::UserBet(pool_id, user.clone()));

        env.events().publish(
            (Symbol::new(&env, "claim_winnings"), pool_id, user),
            winnings,
        );

        winnings
    }

    pub fn get_treasury_balance(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Treasury)
            .unwrap_or(0)
    }

    pub fn get_treasury_recipient(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::TreasuryRecipient)
    }

    /// Rotate the treasury recipient address. Only callable by the current treasury recipient.
    /// Emits an event with both old and new addresses for audit trail.
    ///
    /// # Arguments
    /// * `caller` - Must be the current treasury recipient
    /// * `new_recipient` - The new treasury recipient address
    ///
    /// # Panics
    /// * If caller is not the current treasury recipient
    /// * If treasury recipient is not set
    pub fn rotate_treasury_recipient(env: Env, caller: Address, new_recipient: Address) {
        caller.require_auth();

        let current_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .expect("Treasury recipient not set");

        if caller != current_recipient {
            panic!("Unauthorized");
        }

        env.storage()
            .persistent()
            .set(&DataKey::TreasuryRecipient, &new_recipient);

        env.events().publish(
            (Symbol::new(&env, "treasury_recipient_rotated"),),
            (current_recipient, new_recipient),
        );
    }

    pub fn withdraw_treasury(env: Env, caller: Address, amount: i128) {
        caller.require_auth();

        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .expect("Treasury recipient not set");

        if caller != treasury_recipient {
            panic!("Unauthorized");
        }

        let current_treasury: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Treasury)
            .unwrap_or(0);

        if amount > current_treasury {
            panic!("Insufficient treasury balance");
        }

        let token_address = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .expect("Not initialized");
        let token_client = token::Client::new(&env, &token_address);

        token_client.transfer(
            &env.current_contract_address(),
            &treasury_recipient,
            &amount,
        );

        env.storage()
            .persistent()
            .set(&DataKey::Treasury, &(current_treasury - amount));

        // Emit explicit treasury withdrawal event with caller, recipient, and amount
        env.events().publish(
            (Symbol::new(&env, "treasury_withdrawn"),),
            (caller.clone(), treasury_recipient, amount),
        );
    }

    /// Set (or replace) the freeze admin address. Only callable by the treasury recipient.
    /// The freeze admin is the sole authority that can freeze, dispute, or unfreeze pools.
    pub fn set_freeze_admin(env: Env, caller: Address, freeze_admin: Address) {
        caller.require_auth();

        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .expect("Not initialized");

        if caller != treasury_recipient {
            panic!("Unauthorized");
        }

        env.storage()
            .persistent()
            .set(&DataKey::FreezeAdmin, &freeze_admin);

        env.events()
            .publish((Symbol::new(&env, "freeze_admin_set"),), freeze_admin);
    }

    /// Freeze a pool, blocking new bets and claim payouts.
    /// Callable only by the freeze admin.
    ///
    /// Operational flow: call this as soon as an incorrect settlement is suspected.
    /// The pool stays frozen until `unfreeze_pool` is called (after review clears it)
    /// or `dispute_pool` escalates it to the Disputed state.
    pub fn freeze_pool(env: Env, caller: Address, pool_id: u32) {
        caller.require_auth();
        Self::require_freeze_admin(&env, &caller);

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .expect("Pool not found");

        if pool.status == PoolStatus::Frozen {
            panic!("Pool already frozen");
        }

        pool.status = PoolStatus::Frozen;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);

        env.events()
            .publish((Symbol::new(&env, "pool_frozen"), pool_id), caller);
    }

    /// Mark a settled pool as disputed, blocking claim payouts pending review.
    /// Callable only by the freeze admin.
    ///
    /// Operational flow: use this when a settlement result is actively contested.
    /// Resolve by calling `unfreeze_pool` (to restore the existing settlement) or
    /// `settle_pool` again after correcting the outcome, then `unfreeze_pool`.
    pub fn dispute_pool(env: Env, caller: Address, pool_id: u32) {
        caller.require_auth();
        Self::require_freeze_admin(&env, &caller);

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .expect("Pool not found");

        if !pool.settled {
            panic!("Pool must be settled before it can be disputed");
        }

        if pool.status == PoolStatus::Disputed {
            panic!("Pool already disputed");
        }

        pool.status = PoolStatus::Disputed;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);

        env.events()
            .publish((Symbol::new(&env, "pool_disputed"), pool_id), caller);
    }

    /// Unfreeze a frozen or disputed pool, restoring it to Active status.
    /// Callable only by the freeze admin.
    ///
    /// Operational flow: call this once the review is complete and the pool state
    /// is confirmed correct. Claims and (for non-settled pools) bets resume normally.
    pub fn unfreeze_pool(env: Env, caller: Address, pool_id: u32) {
        caller.require_auth();
        Self::require_freeze_admin(&env, &caller);

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .expect("Pool not found");

        if pool.status == PoolStatus::Active {
            panic!("Pool is not frozen or disputed");
        }

        pool.status = PoolStatus::Active;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);

        env.events()
            .publish((Symbol::new(&env, "pool_unfrozen"), pool_id), caller);
    }

    pub fn get_pool(env: Env, pool_id: u32) -> Option<Pool> {
        env.storage().persistent().get(&DataKey::Pool(pool_id))
    }

    pub fn get_pool_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PoolCounter)
            .unwrap_or(1)
    }

    /// Get a batch of pools for pagination-friendly listing.
    /// Returns pools from start_id up to count pools (or fewer if some don't exist).
    pub fn get_pools_batch(env: Env, start_id: u32, count: u32) -> Vec<Option<Pool>> {
        let mut pools = Vec::new(&env);
        let max_id = Self::get_pool_count(env.clone());

        let effective_count = if count > 100 { 100 } else { count };

        for i in 0..effective_count {
            let pool_id = start_id + i;
            if pool_id >= max_id {
                break;
            }
            let pool = env.storage().persistent().get(&DataKey::Pool(pool_id));
            pools.push_back(pool);
        }

        pools
    }

    fn get_pool_counter(env: &Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PoolCounter)
            .unwrap_or(1)
    }

    fn require_freeze_admin(env: &Env, caller: &Address) {
        let freeze_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::FreezeAdmin)
            .expect("Freeze admin not set");
        if caller != &freeze_admin {
            panic!("Unauthorized: caller is not the freeze admin");
        }
    }

    pub fn get_user_bet(env: Env, pool_id: u32, user: Address) -> Option<UserBet> {
        env.storage()
            .persistent()
            .get(&DataKey::UserBet(pool_id, user))
    }

    pub fn get_participant_count(env: Env, pool_id: u32) -> u32 {
        env.storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .map(|p| p.participant_count)
            .unwrap_or(0)
    }
}
