import re

lib_rs = "contracts/predinex/src/lib.rs"
with open(lib_rs, "r") as f:
    content = f.read()

# 1. Add panic_with_error to imports if not there
if "panic_with_error" not in content:
    content = content.replace("use soroban_sdk::{", "use soroban_sdk::{panic_with_error, ")

# 2. Add is_initialized
is_init_code = """
    fn is_initialized(env: &Env) -> bool {
        env.storage().persistent().has(&DataKey::Token)
    }
"""
if "fn is_initialized" not in content:
    # insert before get_pool_counter
    content = content.replace("    fn get_pool_counter(env: &Env) -> u32 {", is_init_code + "\n    fn get_pool_counter(env: &Env) -> u32 {")

# 3. Add guards to functions
funcs = [
    r"(pub fn create_pool\([^\)]*\)[^{]*\{)",
    r"(pub fn place_bet\([^\)]*\)[^{]*\{)",
    r"(pub fn settle_pool\([^\)]*\)[^{]*\{)",
    r"(pub fn claim_winnings\([^\)]*\)[^{]*\{)",
    r"(pub fn get_pool\([^\)]*\)[^{]*\{)",
    r"(pub fn get_user_bet\([^\)]*\)[^{]*\{)",
    r"(pub fn get_pool_count\([^\)]*\)[^{]*\{)",
]

guard = """
        if !Self::is_initialized(&env) {
            panic_with_error!(&env, ContractError::NotInitialized);
        }"""

for func in funcs:
    def repl(m):
        if "ContractError::NotInitialized" in m.group(0) or guard in content[m.end():m.end()+200]:
            return m.group(1) # already there
        return m.group(1) + guard
    
    content = re.sub(func, repl, content, count=1)

# Also apply to get_pool_counter if the issue author really meant the internal function, just in case (though it doesn't take Env but &Env)
# But wait, Self::is_initialized(&env) works if `env` is Env. If `env` is &Env, then `Self::is_initialized(env)`.
# Let's just stick to the public functions (get_pool_count is the public one).

with open(lib_rs, "w") as f:
    f.write(content)
