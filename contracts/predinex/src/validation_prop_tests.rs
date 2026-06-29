#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};
use std::format;

// ── Deterministic pseudo-random number generator ─────────────────────────────
struct Lcg(u64);

impl Lcg {
    fn new(seed: u64) -> Self {
        Lcg(seed)
    }

    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0
    }

    fn next_in(&mut self, max: u64) -> u64 {
        if max == 0 {
            return 0;
        }
        self.next() % max
    }

    fn next_range(&mut self, min: u64, max: u64) -> u64 {
        if min >= max {
            return min;
        }
        min + (self.next() % (max - min + 1))
    }

    fn next_string(&mut self, env: &Env, len: u32) -> String {
        let mut bytes = std::vec::Vec::with_capacity(len as usize);
        for _ in 0..len {
            // Generate printable ASCII characters (32..126)
            bytes.push(self.next_range(32, 126) as u8);
        }
        let s = std::str::from_utf8(&bytes).unwrap();
        String::from_str(env, s)
    }

    fn next_whitespace_string(&mut self, env: &Env, len: u32) -> String {
        let ws_chars = [b' ', b'\t', b'\n', b'\r'];
        let mut bytes = std::vec::Vec::with_capacity(len as usize);
        for _ in 0..len {
            bytes.push(ws_chars[self.next_in(ws_chars.len() as u64) as usize]);
        }
        let s = std::str::from_utf8(&bytes).unwrap();
        String::from_str(env, s)
    }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

struct TestEnv<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    admin: Address,
}

fn setup_test() -> TestEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token_id.address(), &admin, &admin);

    TestEnv { env, client, admin }
}

// ── Suite V — Validation tests ───────────────────────────────────────────────

/// V1: Title validation.
#[test]
fn v1_test_title_validation() {
    let mut rng = Lcg::new(0x1111_2222_3333_4444);
    let t = setup_test();

    // 1. Random valid titles
    for _ in 0..100 {
        let len = rng.next_range(1, MAX_TITLE_LENGTH as u64) as u32;
        let title = rng.next_string(&t.env, len);
        let description = String::from_str(&t.env, "Valid description");
        let outcome_a = String::from_str(&t.env, "Outcome A");
        let outcome_b = String::from_str(&t.env, "Outcome B");

        let result = t.client.try_create_pool(
            &t.admin,
            &title,
            &description,
            &outcome_a,
            &outcome_b,
            &3600,
            &MIN_CREATOR_DEPOSIT,
        );
        assert!(
            result.is_ok(),
            "Valid title should be accepted: {:?}",
            title
        );
    }

    // 2. Title too long
    let long_title = rng.next_string(&t.env, MAX_TITLE_LENGTH + 1);
    let result = t.client.try_create_pool(
        &t.admin,
        &long_title,
        &String::from_str(&t.env, "Desc"),
        &String::from_str(&t.env, "A"),
        &String::from_str(&t.env, "B"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );
    assert_eq!(result, Err(Ok(ContractError::TitleTooLong)));

    // 3. Title empty
    let empty_title = String::from_str(&t.env, "");
    let result = t.client.try_create_pool(
        &t.admin,
        &empty_title,
        &String::from_str(&t.env, "Desc"),
        &String::from_str(&t.env, "A"),
        &String::from_str(&t.env, "B"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );
    assert_eq!(result, Err(Ok(ContractError::TitleEmpty)));

    // 4. Title whitespace only
    for len in 1..10 {
        let ws_title = rng.next_whitespace_string(&t.env, len);
        let result = t.client.try_create_pool(
            &t.admin,
            &ws_title,
            &String::from_str(&t.env, "Desc"),
            &String::from_str(&t.env, "A"),
            &String::from_str(&t.env, "B"),
            &3600,
            &MIN_CREATOR_DEPOSIT,
        );
        assert_eq!(result, Err(Ok(ContractError::StringWhitespaceOnly)));
    }
}

/// V2: Description validation.
#[test]
fn v2_test_description_validation() {
    let mut rng = Lcg::new(0x5555_6666_7777_8888);
    let t = setup_test();

    // 1. Random valid descriptions
    for _ in 0..100 {
        let len = rng.next_range(1, MAX_DESCRIPTION_LENGTH as u64) as u32;
        let description = rng.next_string(&t.env, len);
        let title = String::from_str(&t.env, "Valid title");
        let outcome_a = String::from_str(&t.env, "Outcome A");
        let outcome_b = String::from_str(&t.env, "Outcome B");

        let result = t.client.try_create_pool(
            &t.admin,
            &title,
            &description,
            &outcome_a,
            &outcome_b,
            &3600,
            &MIN_CREATOR_DEPOSIT,
        );
        assert!(result.is_ok(), "Valid description should be accepted");
    }

    // 2. Description too long
    let long_desc = rng.next_string(&t.env, MAX_DESCRIPTION_LENGTH + 1);
    let result = t.client.try_create_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &long_desc,
        &String::from_str(&t.env, "A"),
        &String::from_str(&t.env, "B"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );
    assert_eq!(result, Err(Ok(ContractError::DescriptionTooLong)));

    // 3. Description empty
    let empty_desc = String::from_str(&t.env, "");
    let result = t.client.try_create_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &empty_desc,
        &String::from_str(&t.env, "A"),
        &String::from_str(&t.env, "B"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );
    assert_eq!(result, Err(Ok(ContractError::DescriptionEmpty)));

    // 4. Description whitespace only
    for len in 1..10 {
        let ws_desc = rng.next_whitespace_string(&t.env, len);
        let result = t.client.try_create_pool(
            &t.admin,
            &String::from_str(&t.env, "Title"),
            &ws_desc,
            &String::from_str(&t.env, "A"),
            &String::from_str(&t.env, "B"),
            &3600,
            &MIN_CREATOR_DEPOSIT,
        );
        assert_eq!(result, Err(Ok(ContractError::StringWhitespaceOnly)));
    }
}

/// V3: Outcomes validation.
#[test]
fn v3_test_outcomes_validation() {
    let mut rng = Lcg::new(0x9999_AAAA_BBBB_CCCC);
    let t = setup_test();

    // 1. Valid multi-outcome pools
    for _ in 0..50 {
        let count = rng.next_range(MIN_OUTCOME_COUNT as u64, MAX_OUTCOME_COUNT as u64) as u32;
        let mut outcomes = Vec::new(&t.env);
        for i in 0..count {
            outcomes.push_back(String::from_str(&t.env, &format!("Outcome {}", i)));
        }

        let result = t.client.try_create_multi_outcome_pool(
            &t.admin,
            &String::from_str(&t.env, "Title"),
            &String::from_str(&t.env, "Desc"),
            &outcomes,
            &3600,
            &None,
        );
        assert!(result.is_ok(), "Valid outcomes should be accepted");
    }

    // 2. Too few outcomes
    let mut few_outcomes = Vec::new(&t.env);
    few_outcomes.push_back(String::from_str(&t.env, "Only one"));
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &few_outcomes,
        &3600,
        &None,
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidOutcome)));

    // 3. Too many outcomes
    let mut many_outcomes = Vec::new(&t.env);
    for i in 0..(MAX_OUTCOME_COUNT + 1) {
        many_outcomes.push_back(String::from_str(&t.env, &format!("Outcome {}", i)));
    }
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &many_outcomes,
        &3600,
        &None,
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidOutcome)));

    // 4. Outcome label too long
    let mut long_outcome = Vec::new(&t.env);
    long_outcome.push_back(rng.next_string(&t.env, MAX_OUTCOME_LENGTH + 1));
    long_outcome.push_back(String::from_str(&t.env, "B"));
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &long_outcome,
        &3600,
        &None,
    );
    assert_eq!(result, Err(Ok(ContractError::OutcomeTooLong)));

    // 5. Outcome label empty
    let mut empty_outcome = Vec::new(&t.env);
    empty_outcome.push_back(String::from_str(&t.env, ""));
    empty_outcome.push_back(String::from_str(&t.env, "B"));
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &empty_outcome,
        &3600,
        &None,
    );
    assert_eq!(result, Err(Ok(ContractError::OutcomeEmpty)));

    // 6. Outcome label whitespace only
    for len in 1..5 {
        let mut ws_outcome = Vec::new(&t.env);
        ws_outcome.push_back(rng.next_whitespace_string(&t.env, len));
        ws_outcome.push_back(String::from_str(&t.env, "B"));
        let result = t.client.try_create_multi_outcome_pool(
            &t.admin,
            &String::from_str(&t.env, "Title"),
            &String::from_str(&t.env, "Desc"),
            &ws_outcome,
            &3600,
            &None,
        );
        assert_eq!(result, Err(Ok(ContractError::StringWhitespaceOnly)));
    }
}

/// V4: Duplicate outcome detection.
#[test]
fn v4_test_duplicate_outcome_detection() {
    let t = setup_test();

    // 1. Exact duplicates
    let mut dup_outcomes = Vec::new(&t.env);
    dup_outcomes.push_back(String::from_str(&t.env, "YES"));
    dup_outcomes.push_back(String::from_str(&t.env, "YES"));
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &dup_outcomes,
        &3600,
        &None,
    );
    assert_eq!(result, Err(Ok(ContractError::DuplicateOutcomeLabels)));

    // 2. Case-insensitive duplicates
    let mut ci_outcomes = Vec::new(&t.env);
    ci_outcomes.push_back(String::from_str(&t.env, "Approve"));
    ci_outcomes.push_back(String::from_str(&t.env, "APPROVE"));
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &ci_outcomes,
        &3600,
        &None,
    );
    assert_eq!(result, Err(Ok(ContractError::DuplicateOutcomeLabels)));

    // 3. Whitespace-padded duplicates
    let mut ws_outcomes = Vec::new(&t.env);
    ws_outcomes.push_back(String::from_str(&t.env, "Reject"));
    ws_outcomes.push_back(String::from_str(&t.env, "  Reject  "));
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &ws_outcomes,
        &3600,
        &None,
    );
    assert_eq!(result, Err(Ok(ContractError::DuplicateOutcomeLabels)));

    // 4. Case and whitespace combined
    let mut combined_outcomes = Vec::new(&t.env);
    combined_outcomes.push_back(String::from_str(&t.env, "Maybe"));
    combined_outcomes.push_back(String::from_str(&t.env, "  MAYBE  "));
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &combined_outcomes,
        &3600,
        &None,
    );
    assert_eq!(result, Err(Ok(ContractError::DuplicateOutcomeLabels)));
}

/// V5: Duration validation.
#[test]
fn v5_test_duration_validation() {
    let mut rng = Lcg::new(0x1234_4321_1234_4321);
    let t = setup_test();

    // 1. Duration too short
    let result = t.client.try_create_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &String::from_str(&t.env, "A"),
        &String::from_str(&t.env, "B"),
        &(MIN_POOL_DURATION_SECS - 1),
        &MIN_CREATOR_DEPOSIT,
    );
    assert_eq!(result, Err(Ok(ContractError::DurationTooShort)));

    // 2. Duration too long
    let result = t.client.try_create_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &String::from_str(&t.env, "A"),
        &String::from_str(&t.env, "B"),
        &(MAX_POOL_DURATION_SECS + 1),
        &MIN_CREATOR_DEPOSIT,
    );
    assert_eq!(result, Err(Ok(ContractError::DurationTooLong)));

    // 3. Duration exact MIN
    let result = t.client.try_create_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &String::from_str(&t.env, "A"),
        &String::from_str(&t.env, "B"),
        &MIN_POOL_DURATION_SECS,
        &MIN_CREATOR_DEPOSIT,
    );
    assert!(result.is_ok());

    // 4. Duration exact MAX
    let result = t.client.try_create_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &String::from_str(&t.env, "A"),
        &String::from_str(&t.env, "B"),
        &MAX_POOL_DURATION_SECS,
        &MIN_CREATOR_DEPOSIT,
    );
    assert!(result.is_ok());

    // 5. 500+ random valid scenarios
    for _ in 0..500 {
        let duration = rng.next_range(MIN_POOL_DURATION_SECS, MAX_POOL_DURATION_SECS);
        let result = t.client.try_create_pool(
            &t.admin,
            &String::from_str(&t.env, "Title"),
            &String::from_str(&t.env, "Desc"),
            &String::from_str(&t.env, "A"),
            &String::from_str(&t.env, "B"),
            &duration,
            &MIN_CREATOR_DEPOSIT,
        );
        assert!(result.is_ok(), "Duration {} should be accepted", duration);
    }
}

/// V6: Metadata URI validation.
#[test]
fn v6_test_metadata_uri_validation() {
    let t = setup_test();

    let outcomes = Vec::from_array(
        &t.env,
        [String::from_str(&t.env, "A"), String::from_str(&t.env, "B")],
    );

    // 1. Valid prefixes
    let valid_prefixes: &[&[u8]] = &[b"https://", b"ipfs://", b"ar://"];
    for prefix in valid_prefixes {
        let mut uri_bytes = prefix.to_vec();
        uri_bytes.extend_from_slice(b"example.com/metadata");
        let s = std::str::from_utf8(&uri_bytes).unwrap();
        let uri = String::from_str(&t.env, s);

        let result = t.client.try_create_multi_outcome_pool(
            &t.admin,
            &String::from_str(&t.env, "Title"),
            &String::from_str(&t.env, "Desc"),
            &outcomes,
            &3600,
            &Some(uri),
        );
        assert!(
            result.is_ok(),
            "Valid prefix {:?} should be accepted",
            std::str::from_utf8(prefix)
        );
    }

    // 2. Invalid prefix
    let invalid_uri = String::from_str(&t.env, "http://insecure.com");
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &outcomes,
        &3600,
        &Some(invalid_uri),
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidOutcome)));

    // 3. URI too long
    let mut long_uri_bytes = b"https://".to_vec();
    long_uri_bytes.extend(std::iter::repeat(b'a').take(MAX_METADATA_URI_LENGTH as usize));
    let s = std::str::from_utf8(&long_uri_bytes).unwrap();
    let long_uri = String::from_str(&t.env, s);
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Desc"),
        &outcomes,
        &3600,
        &Some(long_uri),
    );
    assert_eq!(result, Err(Ok(ContractError::DescriptionTooLong)));
}
