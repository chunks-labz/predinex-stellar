import re

file_path = "contracts/predinex/tests/integration/pool_lifecycle.rs"
with open(file_path, "r") as f:
    content = f.read()

# E1
content = content.replace(
    '#[should_panic(expected = "Pool expired")]\nfn e1_bet_after_expiry_rejected() {',
    'fn e1_bet_after_expiry_rejected() {'
)
content = content.replace(
    'ctx.client.place_bet(&user, &pool_id, &0, &100, &None::<Address>);\n}',
    'let res = ctx.client.try_place_bet(&user, &pool_id, &0, &100, &None::<Address>);\n    assert_eq!(res, Err(Ok(predinex::ContractError::PoolExpired)));\n}'
)

# E2
content = content.replace(
    '#[should_panic(expected = "Pool not settled")]\nfn e2_claim_before_settlement_rejected() {',
    'fn e2_claim_before_settlement_rejected() {'
)
content = content.replace(
    '// Pool not settled yet\n    ctx.client.claim_winnings(&user, &pool_id);\n}',
    '// Pool not settled yet\n    let res = ctx.client.try_claim_winnings(&user, &pool_id);\n    assert_eq!(res, Err(Ok(predinex::ContractError::PoolNotSettled)));\n}'
)

# E3
content = content.replace(
    '#[should_panic(expected = "Pool has not expired yet")]\nfn e3_settle_before_expiry_rejected() {',
    'fn e3_settle_before_expiry_rejected() {'
)
content = content.replace(
    '// Timestamp is still 0, pool expires at 3600\n    ctx.client.settle_pool(&creator, &pool_id, &0);\n}',
    '// Timestamp is still 0, pool expires at 3600\n    let res = ctx.client.try_settle_pool(&creator, &pool_id, &0);\n    assert_eq!(res, Err(Ok(predinex::ContractError::PoolNotExpired)));\n}'
)

# E9
content = content.replace(
    '#[should_panic(expected = "Dispute window expired")]\nfn e9_dispute_after_window_rejected() {',
    'fn e9_dispute_after_window_rejected() {'
)
content = content.replace(
    'ctx.client.dispute_pool(\n        &user,\n        &pool_id,\n    );\n}',
    'let res = ctx.client.try_dispute_pool(&user, &pool_id);\n    assert_eq!(res, Err(Ok(predinex::ContractError::DisputeWindowExpired)));\n}'
)

# L3
content = content.replace(
    '#[should_panic(expected = "No winnings to claim")]\nfn l3_losing_bettor_cannot_claim() {',
    'fn l3_losing_bettor_cannot_claim() {'
)
content = content.replace(
    'ctx.client.claim_winnings(&loser, &pool_id);\n}',
    'let res = ctx.client.try_claim_winnings(&loser, &pool_id);\n    assert_eq!(res, Err(Ok(predinex::ContractError::NoWinningsToClaim)));\n}'
)

with open(file_path, "w") as f:
    f.write(content)
