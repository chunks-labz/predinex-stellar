# Collateral Approval Flow

This page covers what a user must do before their first trade, which wallet prompts to expect, and how to revoke access if you want to.

## Short answer

Predinex does not use token allowances. The contract moves tokens with a direct transfer that the user authorizes in the wallet, so there is no separate on-chain approval to grant first. Before a trade you only need:

1. A connected Stellar wallet that holds enough of the market's token.
2. A fee confirmation in the app, if it asks for one.
3. A signature in the wallet for each transaction.

The contract checks the authorization on every call, so there is nothing to revoke on-chain to stop a market from taking your tokens.

## Steps before your first trade

### 1. Connect a wallet

Open the app and connect your Stellar wallet. The app reads your address from the wallet and shows the balances for the markets you can trade.

<!-- Screenshot placeholder: wallet connect dialog -->

### 2. Check your token balance

The market shows the token it is denominated in. Make sure your wallet holds at least the amount you plan to bet, plus enough XLM to pay the network fee.

<!-- Screenshot placeholder: market page showing token and balance -->

### 3. Confirm the fee

Before a transaction is signed, the app estimates the network fee and may ask you to confirm it. If you decline, the transaction is cancelled and nothing is sent.

<!-- Screenshot placeholder: fee confirmation prompt -->

### 4. Sign the transaction

Your wallet opens with the transaction. Check the contract and the amount, then approve. Each bet, cancel, and claim is a separate transaction, and each one needs its own approval.

<!-- Screenshot placeholder: wallet signing prompt -->

## What each step moves

| Action | Tokens that move | Where they go |
|---|---|---|
| Place a bet | Your stake | Into the contract, held as collateral |
| Cancel a bet | The stake you placed, before the market expires | Back to you |
| Claim winnings | The payout | From the contract to you |
| Claim a refund | The refund amount | From the contract to you |

The contract's `place_bet` takes the stake and transfers it into the contract in the same call. No prior allowance is needed.

## Revoking access

- **On-chain:** there is no allowance to revoke because none is granted. Once a bet is settled or cancelled, the contract holds no tokens for that bet.
- **In the app:** disconnect the wallet from the app. This clears the session in your browser.
- **In the wallet:** most Stellar wallets show a list of connected sites. Remove the app there to stop it from requesting new signatures.

Do not share your secret key or seed phrase with the app or anyone else, including support staff.

## Troubleshooting

- **Insufficient balance:** top up the market token or reduce the stake.
- **Insufficient XLM for fees:** add XLM to the wallet. The fee is paid in XLM.
- **Transaction cancelled:** you declined the fee confirmation or the wallet prompt. Retry if you meant to continue.
- **Market not open:** a market is only tradeable while it is open. See the [Market Lifecycle](./MARKET_LIFECYCLE.md).
