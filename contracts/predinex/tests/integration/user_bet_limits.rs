//! Per-wallet bet limit tracking integration tests.
//!
//! `check_user_exposure_limits` validates each bet against the accumulated
//! daily and weekly loss windows and against the timestamp of the wallet's last
//! large bet. None of that state was ever written, so every limit only saw a
//! zero baseline. These tests pin down that the state is persisted and that the
//! limits therefore apply cumulatively.

extern crate std;

use predinex::{PredinexContract, PredinexContractClient, MIN_CREATOR_DEPOSIT};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

/// Contract-wide minimum bet (`MIN_BET_AMOUNT`). Every amount below is a
/// multiple of it so no bet is rejected as dust before the limits are reached.
const UNIT: i128 = 1_000_000;
const DAY_SECS: u64 = 86_400;
const WEEK_SECS: u64 = 604_800;
/// Generous per-bettor balance — larger than any test's total stake.
const FUNDING: i128 = 1_000 * UNIT;

/// Contract client plus the actors and token needed to place bets.
struct Ctx<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    token_admin: token::StellarAssetClient<'a>,
    treasury: Address,
}

/// Boot a fresh environment with the contract initialised and auths mocked.
fn setup() -> Ctx<'static> {
    let env = Env::default();
    env.mock_all_auths();
    // Start from a realistic ledger time rather than the epoch, so window and
    // cooldown arithmetic is not tested against timestamp 0.
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);

    let treasury = Address::generate(&env);
    let token_admin_addr = Address::generate(&env);
    let token_asset = env.register_stellar_asset_contract_v2(token_admin_addr);

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);
    client.initialize(&token_asset.address(), &treasury, &treasury);

    let token_admin: token::StellarAssetClient<'static> =
        token::StellarAssetClient::new(&env, &token_asset.address());

    Ctx {
        env,
        client,
        token_admin,
        treasury,
    }
}

/// Configure the per-wallet limits under test. `0` disables an individual limit.
fn configure_limits(
    ctx: &Ctx,
    daily_loss_limit: i128,
    weekly_loss_limit: i128,
    large_bet_cooldown_secs: u64,
    large_bet_threshold: i128,
) {
    ctx.client.set_user_exposure_config(
        &ctx.treasury,
        &0u32,  // max_exposure_per_pool_bps — disabled
        &0i128, // max_bet_per_transaction — disabled
        &daily_loss_limit,
        &DAY_SECS,
        &weekly_loss_limit,
        &WEEK_SECS,
        &large_bet_cooldown_secs,
        &large_bet_threshold,
    );
}

/// Create a pool with a 30-day duration so bets stay valid across window tests.
fn make_pool(ctx: &Ctx, creator: &Address) -> u32 {
    ctx.client.create_pool(
        creator,
        &String::from_str(&ctx.env, "Will BTC hit $100k?"),
        &String::from_str(&ctx.env, "Binary prediction market"),
        &String::from_str(&ctx.env, "Yes"),
        &String::from_str(&ctx.env, "No"),
        &(30 * DAY_SECS),
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    )
}

/// Mint enough tokens for a bettor to cover every bet in a test.
fn fund(ctx: &Ctx, addr: &Address) {
    ctx.token_admin.mint(addr, &FUNDING);
}

/// Place a bet on outcome A for `units` multiples of the minimum bet.
fn bet(ctx: &Ctx, bettor: &Address, pool_id: u32, units: i128) {
    ctx.client
        .place_bet(bettor, &pool_id, &0, &(units * UNIT), &None::<Address>);
}

fn advance(ctx: &Ctx, secs: u64) {
    ctx.env.ledger().with_mut(|l| l.timestamp += secs);
}

fn daily_loss(ctx: &Ctx, user: &Address) -> i128 {
    ctx.client.get_user_daily_loss_status(user).loss
}

fn weekly_loss(ctx: &Ctx, user: &Address) -> i128 {
    ctx.client.get_user_weekly_loss_status(user).loss
}

// ---------------------------------------------------------------------------
// Daily loss window
// ---------------------------------------------------------------------------

/// A single bet is recorded against the daily window rather than leaving it at zero.
#[test]
fn daily_loss_state_is_persisted_after_a_bet() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 10 * UNIT, 0, 0, 0);
    let pool_id = make_pool(&ctx, &creator);

    assert_eq!(daily_loss(&ctx, &bettor), 0);

    bet(&ctx, &bettor, pool_id, 3);

    assert_eq!(
        daily_loss(&ctx, &bettor),
        3 * UNIT,
        "the bet must be recorded against the daily window"
    );
}

/// Successive bets accumulate rather than each being measured from zero.
#[test]
fn daily_losses_accumulate_across_bets() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 10 * UNIT, 0, 0, 0);
    let pool_id = make_pool(&ctx, &creator);

    for _ in 0..3 {
        bet(&ctx, &bettor, pool_id, 3);
    }

    assert_eq!(daily_loss(&ctx, &bettor), 9 * UNIT);
}

/// The daily cap rejects the bet that pushes the running total past the limit,
/// even though no single bet exceeds it on its own.
#[test]
#[should_panic(expected = "Error(Contract, #81)")]
fn cumulative_daily_loss_over_limit_is_rejected() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 10 * UNIT, 0, 0, 0);
    let pool_id = make_pool(&ctx, &creator);

    // 3 + 3 + 3 = 9 units, still under the 10-unit cap.
    for _ in 0..3 {
        bet(&ctx, &bettor, pool_id, 3);
    }

    // The fourth bet would take the running total to 12 units.
    bet(&ctx, &bettor, pool_id, 3);
}

/// A bet that lands exactly on the cap is allowed; the next one is not.
#[test]
fn daily_loss_limit_boundary_is_inclusive() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 10 * UNIT, 0, 0, 0);
    let pool_id = make_pool(&ctx, &creator);

    bet(&ctx, &bettor, pool_id, 6);
    bet(&ctx, &bettor, pool_id, 4);

    assert_eq!(daily_loss(&ctx, &bettor), 10 * UNIT);
    assert!(
        ctx.client
            .try_place_bet(&bettor, &pool_id, &0, &UNIT, &None::<Address>)
            .is_err(),
        "a further bet must be rejected once the total sits exactly on the cap"
    );
}

/// Accumulated loss is discarded once the configured window has elapsed.
#[test]
fn daily_window_resets_after_it_elapses() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 10 * UNIT, 0, 0, 0);
    let pool_id = make_pool(&ctx, &creator);

    bet(&ctx, &bettor, pool_id, 9);
    assert_eq!(daily_loss(&ctx, &bettor), 9 * UNIT);

    advance(&ctx, DAY_SECS);

    // Would breach the cap inside the previous window, but the window rolled.
    bet(&ctx, &bettor, pool_id, 9);
    assert_eq!(daily_loss(&ctx, &bettor), 9 * UNIT);
}

/// Limits are per wallet: one bettor's total does not restrict another's.
#[test]
fn loss_tracking_is_isolated_per_wallet() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);
    fund(&ctx, &alice);
    fund(&ctx, &bob);

    configure_limits(&ctx, 10 * UNIT, 0, 0, 0);
    let pool_id = make_pool(&ctx, &creator);

    bet(&ctx, &alice, pool_id, 9);
    bet(&ctx, &bob, pool_id, 9);

    assert_eq!(daily_loss(&ctx, &alice), 9 * UNIT);
    assert_eq!(daily_loss(&ctx, &bob), 9 * UNIT);
}

/// No storage is written for a limit the admin has left disabled.
#[test]
fn no_loss_state_is_written_when_the_limit_is_disabled() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 0, 0, 0, 0);
    let pool_id = make_pool(&ctx, &creator);

    bet(&ctx, &bettor, pool_id, 9);

    assert_eq!(daily_loss(&ctx, &bettor), 0);
    assert_eq!(weekly_loss(&ctx, &bettor), 0);
}

// ---------------------------------------------------------------------------
// Weekly loss window
// ---------------------------------------------------------------------------

/// The weekly window accumulates independently of the daily one.
#[test]
fn weekly_losses_accumulate_across_bets() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 0, 50 * UNIT, 0, 0);
    let pool_id = make_pool(&ctx, &creator);

    for _ in 0..4 {
        bet(&ctx, &bettor, pool_id, 10);
    }

    assert_eq!(weekly_loss(&ctx, &bettor), 40 * UNIT);
    assert_eq!(
        daily_loss(&ctx, &bettor),
        0,
        "the daily limit is disabled, so no daily state is written"
    );
}

/// The weekly cap rejects the bet that crosses it, spanning several days.
#[test]
#[should_panic(expected = "Error(Contract, #82)")]
fn cumulative_weekly_loss_over_limit_is_rejected() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 0, 50 * UNIT, 0, 0);
    let pool_id = make_pool(&ctx, &creator);

    for _ in 0..5 {
        bet(&ctx, &bettor, pool_id, 10);
        advance(&ctx, DAY_SECS);
    }

    // The total already sits at 50 units; anything more breaches the weekly cap.
    bet(&ctx, &bettor, pool_id, 10);
}

/// A daily reset does not clear the longer weekly window.
#[test]
fn weekly_total_survives_a_daily_window_reset() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 20 * UNIT, 50 * UNIT, 0, 0);
    let pool_id = make_pool(&ctx, &creator);

    bet(&ctx, &bettor, pool_id, 15);
    advance(&ctx, DAY_SECS);
    bet(&ctx, &bettor, pool_id, 15);

    assert_eq!(
        daily_loss(&ctx, &bettor),
        15 * UNIT,
        "the daily window rolled over"
    );
    assert_eq!(
        weekly_loss(&ctx, &bettor),
        30 * UNIT,
        "the weekly window is still open"
    );
}

/// The weekly window rolls over on its own schedule.
#[test]
fn weekly_window_resets_after_it_elapses() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 0, 50 * UNIT, 0, 0);
    let pool_id = make_pool(&ctx, &creator);

    bet(&ctx, &bettor, pool_id, 45);
    advance(&ctx, WEEK_SECS);
    bet(&ctx, &bettor, pool_id, 45);

    assert_eq!(weekly_loss(&ctx, &bettor), 45 * UNIT);
}

// ---------------------------------------------------------------------------
// Large bet cooldown
// ---------------------------------------------------------------------------

/// A second large bet inside the cooldown is rejected.
#[test]
#[should_panic(expected = "Error(Contract, #86)")]
fn large_bet_cooldown_blocks_a_second_large_bet() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 0, 0, 3_600, 10 * UNIT);
    let pool_id = make_pool(&ctx, &creator);

    bet(&ctx, &bettor, pool_id, 10);
    advance(&ctx, 60);
    bet(&ctx, &bettor, pool_id, 10);
}

/// The first large bet is always allowed — there is no prior timestamp.
#[test]
fn first_large_bet_is_allowed() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 0, 0, 3_600, 10 * UNIT);
    let pool_id = make_pool(&ctx, &creator);

    bet(&ctx, &bettor, pool_id, 20);
}

/// Bets below the threshold are unaffected by the cooldown.
#[test]
fn cooldown_ignores_bets_below_the_threshold() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 0, 0, 3_600, 10 * UNIT);
    let pool_id = make_pool(&ctx, &creator);

    bet(&ctx, &bettor, pool_id, 10);
    for _ in 0..3 {
        bet(&ctx, &bettor, pool_id, 9);
    }
}

/// Once the cooldown elapses another large bet goes through.
#[test]
fn large_bet_allowed_again_after_the_cooldown() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 0, 0, 3_600, 10 * UNIT);
    let pool_id = make_pool(&ctx, &creator);

    bet(&ctx, &bettor, pool_id, 10);
    advance(&ctx, 3_600);
    bet(&ctx, &bettor, pool_id, 10);
}

/// With the cooldown disabled, repeated large bets are unrestricted. This is
/// the regression the daily-window proxy would otherwise cause once the daily
/// state is written: it fired for every bet inside the open daily window.
#[test]
fn no_cooldown_when_it_is_disabled() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let bettor = Address::generate(&ctx.env);
    fund(&ctx, &bettor);

    configure_limits(&ctx, 100 * UNIT, 0, 0, 0);
    let pool_id = make_pool(&ctx, &creator);

    for _ in 0..4 {
        bet(&ctx, &bettor, pool_id, 20);
    }

    assert_eq!(daily_loss(&ctx, &bettor), 80 * UNIT);
}
