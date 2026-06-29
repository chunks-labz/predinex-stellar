import re

lib_rs = "contracts/predinex/src/lib.rs"
with open(lib_rs, "r") as f:
    lib_content = f.read()

# Fix place_bet returning InvalidBetAmount instead of BetBelowMinBet / BetAboveMaxBet
lib_content = lib_content.replace(
    "if min_bet > 0 && amount < min_bet {\n            return Err(ContractError::InvalidBetAmount);\n        }",
    "if min_bet > 0 && amount < min_bet {\n            return Err(ContractError::BetBelowMinBet);\n        }"
)
lib_content = lib_content.replace(
    "if max_bet > 0 && amount > max_bet {\n            return Err(ContractError::InvalidBetAmount);\n        }",
    "if max_bet > 0 && amount > max_bet {\n            return Err(ContractError::BetAboveMaxBet);\n        }"
)

with open(lib_rs, "w") as f:
    f.write(lib_content)

test_rs = "contracts/predinex/src/test.rs"
with open(test_rs, "r") as f:
    test_content = f.read()

# Fix existing tests that didn't initialize
def fix_test(test_name, content):
    pattern = rf"(fn {test_name}\([^\)]*\)\s*\{{.*?let client = PredinexContractClient::new\(&env, &contract_id\);)"
    replacement = r"\1\n    client.initialize(&Address::generate(&env), &Address::generate(&env));"
    return re.sub(pattern, replacement, content, flags=re.DOTALL)

test_content = fix_test("test_create_pool", test_content)
test_content = fix_test("test_create_pool_accepts_duration_just_below_maximum", test_content)
test_content = fix_test("test_list_pools_empty_returns_empty", test_content)

with open(test_rs, "w") as f:
    f.write(test_content)
