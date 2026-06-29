import re

test_rs = "contracts/predinex/src/test.rs"
with open(test_rs, "r") as f:
    content = f.read()

# We need to add tests for NotInitialized panic.
# Let's see how tests are structured.
# I'll just append them at the end.

tests_to_add = """
#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_create_pool_not_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PredinexContract);
    let client = PredinexContractClient::new(&env, &contract_id);

    client.create_pool(
        &Address::generate(&env),
        &String::from_str(&env, "Title"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, "A"),
        &String::from_str(&env, "B"),
        &3600,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_place_bet_not_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PredinexContract);
    let client = PredinexContractClient::new(&env, &contract_id);

    client.place_bet(&Address::generate(&env), &1, &0, &100, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_settle_pool_not_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PredinexContract);
    let client = PredinexContractClient::new(&env, &contract_id);

    client.settle_pool(&Address::generate(&env), &1, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_claim_winnings_not_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PredinexContract);
    let client = PredinexContractClient::new(&env, &contract_id);

    client.claim_winnings(&Address::generate(&env), &1);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_get_pool_not_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PredinexContract);
    let client = PredinexContractClient::new(&env, &contract_id);

    client.get_pool(&1);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_get_user_bet_not_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PredinexContract);
    let client = PredinexContractClient::new(&env, &contract_id);

    client.get_user_bet(&1, &Address::generate(&env));
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_get_pool_count_not_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PredinexContract);
    let client = PredinexContractClient::new(&env, &contract_id);

    client.get_pool_count();
}
"""

if "fn test_create_pool_not_initialized" not in content:
    with open(test_rs, "a") as f:
        f.write(tests_to_add)
