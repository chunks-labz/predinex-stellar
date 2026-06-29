# Predinex Contract Specification

For a complete API reference, see [web/docs/CONTRACT_API.md](../web/docs/CONTRACT_API.md).

## Core Methods

### initialize(...)
Description: Initializes contract state

Example:
stellar contract invoke \
--id <CONTRACT_ID> \
--fn initialize \
--arg ...

---

### create_pool(...)
Description: Creates prediction pool

Example:
stellar contract invoke \
--id <CONTRACT_ID> \
--fn create_pool \
--arg ...

### bet(...)
Description: Places a bet on a prediction pool

Example:
stellar contract invoke \
--id <CONTRACT_ID> \
--fn bet \
--arg ...

### settle(...)
Description: Settles a prediction pool after outcome is known

Example:
stellar contract invoke \
--id <CONTRACT_ID> \
--fn settle \
--arg ...

### claim(...)
Description: Claims winnings from a settled pool

Example:
stellar contract invoke \
--id <CONTRACT_ID> \
--fn claim \
--arg ...

### treasury(...)
Description: Interacts with the contract treasury (withdraw fees, etc.)

Example:
stellar contract invoke \
--id <CONTRACT_ID> \
--fn treasury \
--arg ...

## Events

### BetPlaced
{
  user: Address,
  amount: i128,
  outcome: u32,
  total_yes: i128,
  total_no: i128
}

## CI Integration

Update .github/workflows:

- name: Validate contract spec exists
  run: test -f docs/CONTRACT_SPEC.md