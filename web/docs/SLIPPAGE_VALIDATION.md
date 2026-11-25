# Slippage Validation

Betting accepts an optional max-slippage percentage from the UI. It is a client-side guard only; the Soroban contract and RPC call signatures are unchanged.

## Range and units

- Unit: percent (`%`), not basis points or a decimal fraction.
- Accepted range: `0.01` through `5`, inclusive.
- Default: `0.5` (`0.5%`).

The exported constants in `lib/validators.ts` are the source of truth:
`MIN_SLIPPAGE_PERCENT`, `MAX_SLIPPAGE_PERCENT`, and `DEFAULT_SLIPPAGE_PERCENT`.

## Rejected values

`validateSlippage(value: string | number)` rejects:

- Empty or whitespace-only input: "Slippage is required".
- Non-numeric values, `NaN`, and `Infinity`: "Slippage must be a number".
- Zero or negative values: "Slippage must be greater than 0".
- Values below `0.01`: "Slippage must be at least 0.01%".
- Values above `5`: "Slippage must be 5% or less".

## Where validation runs

`BettingSection` validates slippage on change/blur and again immediately before
`placeBetSoroban`. Both checks happen before the contract adapter can reach
`simulateTransaction`, so invalid input never produces a wallet prompt or RPC
simulation. The inline field shows an `aria-invalid` state, an
`aria-describedby` range hint, and a `role="alert"` error; confirmation, bet
buttons, and retry stay disabled while the value is invalid.
