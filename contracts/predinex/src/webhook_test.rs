//! Tests for the webhook registration system — Issue #396
//!
//! Coverage:
//!  - register_webhook: happy path, storage and retrieval
//!  - register_webhook: HTTPS-only URL validation (rejects http:// and bare URLs)
//!  - register_webhook: max-10-webhook cap enforcement
//!  - register_webhook: idempotent update (same URL replaces in-place, no cap charge)
//!  - register_webhook: unauthorized caller rejected
//!  - register_webhook: URL length cap (> 512 bytes rejected)
//!  - register_webhook: emits `webhook_registered` event
//!  - unregister_webhook: happy path, storage updated
//!  - unregister_webhook: WebhookNotFound on missing URL
//!  - unregister_webhook: unauthorized caller rejected
//!  - unregister_webhook: emits `webhook_unregistered` event
//!  - get_webhooks: returns empty vec when nothing registered
//!  - get_webhooks: returns all registered entries

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events},
    Address, Env, String, Val, Vec,
};

fn has_event_topic(env: &Env, events: &soroban_sdk::testutils::ContractEvents, name: &str) -> bool {
    events.events().iter().any(|event| {
        match &event.body {
            soroban_sdk::xdr::ContractEventBody::V0(v0) => {
                if let Some(first) = v0.topics.first() {
                    if let Ok(val) = <Val as soroban_sdk::TryFromVal<Env, soroban_sdk::xdr::ScVal>>::try_from_val(env, first) {
                        if let Ok(sym) = <soroban_sdk::Symbol as soroban_sdk::TryFromVal<Env, Val>>::try_from_val(env, &val) {
                            return sym == soroban_sdk::Symbol::new(env, name);
                        }
                    }
                }
                false
            }
        }
    })
}

// ── Test harness ──────────────────────────────────────────────────────────────

struct Ctx {
    env: Env,
    client: PredinexContractClient<'static>,
    /// The treasury_recipient address (passed as `caller` to admin functions).
    admin: Address,
}

impl Ctx {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(PredinexContract, ());
        // SAFETY: lifetime extension matches the pattern used across this repo.
        let client: PredinexContractClient<'static> =
            unsafe { core::mem::transmute(PredinexContractClient::new(&env, &contract_id)) };

        // initialize() stores the second argument as TreasuryRecipient.
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        client.initialize(&token_id.address(), &token_admin);

        Ctx {
            env,
            client,
            admin: token_admin,
        }
    }

    fn url(&self, s: &str) -> String {
        String::from_str(&self.env, s)
    }

    fn event_types_all(&self) -> Vec<WebhookEventType> {
        let mut v: Vec<WebhookEventType> = Vec::new(&self.env);
        v.push_back(WebhookEventType::PoolCreated);
        v.push_back(WebhookEventType::BetPlaced);
        v.push_back(WebhookEventType::PoolSettled);
        v.push_back(WebhookEventType::ClaimProcessed);
        v.push_back(WebhookEventType::PoolDisputed);
        v
    }

    fn event_types_one(&self) -> Vec<WebhookEventType> {
        let mut v: Vec<WebhookEventType> = Vec::new(&self.env);
        v.push_back(WebhookEventType::PoolCreated);
        v
    }
}

// ── get_webhooks: baseline ─────────────────────────────────────────────────────

#[test]
fn test_get_webhooks_returns_empty_when_none_registered() {
    let ctx = Ctx::new();
    let result = ctx.client.get_webhooks();
    assert_eq!(result.len(), 0);
}

// ── register_webhook: happy path ──────────────────────────────────────────────

#[test]
fn test_register_webhook_stores_and_get_webhooks_retrieves() {
    let ctx = Ctx::new();
    let url = ctx.url("https://example.com/webhook");
    let event_types = ctx.event_types_all();

    ctx.client
        .register_webhook(&ctx.admin, &url, &event_types);

    let hooks = ctx.client.get_webhooks();
    assert_eq!(hooks.len(), 1);
    let hook = hooks.get(0).unwrap();
    assert_eq!(hook.url, url);
    assert_eq!(hook.event_types.len(), 5);
}

#[test]
fn test_register_webhook_multiple_urls_stored_independently() {
    let ctx = Ctx::new();
    let et = ctx.event_types_one();

    ctx.client
        .register_webhook(&ctx.admin, &ctx.url("https://a.example.com/wh"), &et);
    ctx.client
        .register_webhook(&ctx.admin, &ctx.url("https://b.example.com/wh"), &et);

    let hooks = ctx.client.get_webhooks();
    assert_eq!(hooks.len(), 2);
}

// ── register_webhook: URL validation ──────────────────────────────────────────

#[test]
fn test_register_webhook_rejects_http_url() {
    let ctx = Ctx::new();
    let result = ctx.client.try_register_webhook(
        &ctx.admin,
        &ctx.url("http://insecure.example.com/wh"),
        &ctx.event_types_one(),
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidWebhookUrl)));
}

#[test]
fn test_register_webhook_rejects_bare_domain() {
    let ctx = Ctx::new();
    let result = ctx.client.try_register_webhook(
        &ctx.admin,
        &ctx.url("example.com/wh"),
        &ctx.event_types_one(),
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidWebhookUrl)));
}

#[test]
fn test_register_webhook_rejects_ftp_url() {
    let ctx = Ctx::new();
    let result = ctx.client.try_register_webhook(
        &ctx.admin,
        &ctx.url("ftp://files.example.com/wh"),
        &ctx.event_types_one(),
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidWebhookUrl)));
}

#[test]
fn test_register_webhook_accepts_https_url_with_path_and_query() {
    let ctx = Ctx::new();
    ctx.client
        .register_webhook(
            &ctx.admin,
            &ctx.url("https://hooks.example.com/v1/predinex?token=abc123"),
            &ctx.event_types_one(),
        );
    assert_eq!(ctx.client.get_webhooks().len(), 1);
}

#[test]
fn test_register_webhook_rejects_url_exceeding_512_bytes() {
    let ctx = Ctx::new();
    // Build a URL that is longer than MAX_WEBHOOK_URL_LENGTH (512).
    // "https://" is 8 bytes; add 505 'a' chars → 513 bytes total.
    let mut long = std::string::String::from("https://");
    for _ in 0..505 {
        long.push('a');
    }
    long.push_str(".com");
    let result = ctx.client.try_register_webhook(
        &ctx.admin,
        &String::from_str(&ctx.env, &long),
        &ctx.event_types_one(),
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidWebhookUrl)));
}

// ── register_webhook: cap enforcement ─────────────────────────────────────────

#[test]
fn test_register_webhook_enforces_max_10_limit() {
    let ctx = Ctx::new();
    let et = ctx.event_types_one();

    // Register exactly 10 webhooks — all should succeed.
    for i in 0u32..10 {
        let url = std::format!("https://hook{}.example.com/wh", i);
        ctx.client
            .register_webhook(&ctx.admin, &String::from_str(&ctx.env, &url), &et);
    }
    assert_eq!(ctx.client.get_webhooks().len(), 10);

    // The 11th registration must fail.
    let result = ctx.client.try_register_webhook(
        &ctx.admin,
        &ctx.url("https://hook10.example.com/wh"),
        &et,
    );
    assert_eq!(result, Err(Ok(ContractError::WebhookLimitReached)));
    // Storage unchanged.
    assert_eq!(ctx.client.get_webhooks().len(), 10);
}

#[test]
fn test_register_webhook_update_existing_does_not_count_toward_cap() {
    let ctx = Ctx::new();
    let et = ctx.event_types_one();

    // Fill to 10.
    for i in 0u32..10 {
        let url = std::format!("https://hook{}.example.com/wh", i);
        ctx.client
            .register_webhook(&ctx.admin, &String::from_str(&ctx.env, &url), &et);
    }

    // Re-registering an existing URL must succeed (update, not new entry).
    let first_url = ctx.url("https://hook0.example.com/wh");
    let new_et = ctx.event_types_all();
    ctx.client
        .register_webhook(&ctx.admin, &first_url, &new_et);

    // Still exactly 10 entries.
    let hooks = ctx.client.get_webhooks();
    assert_eq!(hooks.len(), 10);

    // The updated entry has 5 event types now.
    let updated = hooks.get(0).unwrap();
    assert_eq!(updated.event_types.len(), 5);
}

// ── register_webhook: auth guard ──────────────────────────────────────────────

#[test]
fn test_register_webhook_rejects_unauthorized_caller() {
    let ctx = Ctx::new();
    let stranger = Address::generate(&ctx.env);
    let result = ctx.client.try_register_webhook(
        &stranger,
        &ctx.url("https://evil.example.com/wh"),
        &ctx.event_types_one(),
    );
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

// ── register_webhook: event emission ──────────────────────────────────────────

#[test]
fn test_register_webhook_emits_webhook_registered_event() {
    let ctx = Ctx::new();
    let url = ctx.url("https://events.example.com/wh");

    ctx.client
        .register_webhook(&ctx.admin, &url, &ctx.event_types_one());

    let events = ctx.env.events().all();
    let found = has_event_topic(&ctx.env, &events, "webhook_registered");
    assert!(found, "expected webhook_registered event to be emitted");
}

// ── unregister_webhook: happy path ────────────────────────────────────────────

#[test]
fn test_unregister_webhook_removes_entry() {
    let ctx = Ctx::new();
    let url = ctx.url("https://example.com/wh");
    ctx.client
        .register_webhook(&ctx.admin, &url, &ctx.event_types_one());
    assert_eq!(ctx.client.get_webhooks().len(), 1);

    ctx.client.unregister_webhook(&ctx.admin, &url);
    assert_eq!(ctx.client.get_webhooks().len(), 0);
}

#[test]
fn test_unregister_webhook_removes_correct_entry_among_multiple() {
    let ctx = Ctx::new();
    let et = ctx.event_types_one();
    let url_a = ctx.url("https://a.example.com/wh");
    let url_b = ctx.url("https://b.example.com/wh");

    ctx.client.register_webhook(&ctx.admin, &url_a, &et);
    ctx.client.register_webhook(&ctx.admin, &url_b, &et);

    ctx.client.unregister_webhook(&ctx.admin, &url_a);

    let hooks = ctx.client.get_webhooks();
    assert_eq!(hooks.len(), 1);
    assert_eq!(hooks.get(0).unwrap().url, url_b);
}

// ── unregister_webhook: WebhookNotFound ───────────────────────────────────────

#[test]
fn test_unregister_webhook_not_found_returns_error() {
    let ctx = Ctx::new();
    let result =
        ctx.client
            .try_unregister_webhook(&ctx.admin, &ctx.url("https://ghost.example.com/wh"));
    assert_eq!(result, Err(Ok(ContractError::WebhookNotFound)));
}

// ── unregister_webhook: auth guard ────────────────────────────────────────────

#[test]
fn test_unregister_webhook_rejects_unauthorized_caller() {
    let ctx = Ctx::new();
    let url = ctx.url("https://example.com/wh");
    ctx.client
        .register_webhook(&ctx.admin, &url, &ctx.event_types_one());

    let stranger = Address::generate(&ctx.env);
    let result = ctx.client.try_unregister_webhook(&stranger, &url);
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));

    // Webhook must still be there.
    assert_eq!(ctx.client.get_webhooks().len(), 1);
}

// ── unregister_webhook: event emission ────────────────────────────────────────

#[test]
fn test_unregister_webhook_emits_webhook_unregistered_event() {
    let ctx = Ctx::new();
    let url = ctx.url("https://example.com/wh");
    ctx.client
        .register_webhook(&ctx.admin, &url, &ctx.event_types_one());

    ctx.client.unregister_webhook(&ctx.admin, &url);

    let events = ctx.env.events().all();
    let found = has_event_topic(&ctx.env, &events, "webhook_unregistered");
    assert!(found, "expected webhook_unregistered event to be emitted");
}
