# Glossary of Market Terms

Definitions for the terms used across the Predinex docs, contracts and API. Where a term has an exact contract definition, the definition below follows the code. The [Market Lifecycle](./MARKET_LIFECYCLE.md) page has the full state machine.

**Market.** A prediction pool that people bet on. Each market asks a question with a fixed set of outcomes, for example yes or no. Bets are held in the contract until the market settles, is voided, or is cancelled. Also called a *pool* in the contract.

**Position.** A user's stake in one market: how much they have bet on each outcome. A position is open while the market is open, and it becomes claimable after settlement.

**Outcome.** One of the possible answers to a market's question. A market settles to exactly one winning outcome.

**Collateral.** Tokens the contract holds to back a market. Bets are transferred into the contract when they are placed, and winnings and refunds are paid out of that balance. A market creator also deposits a minimum amount (`MIN_CREATOR_DEPOSIT` in the contract) as an anti-spam measure. See [Collateral Approval Flow](./COLLATERAL_APPROVAL.md) for the steps a user goes through.

**Oracle.** The source of a resolution or price signal the protocol relies on. Resolution signals are signed messages checked against the configured signer. The message format is in [Oracle Message Format](./ORACLE_MESSAGE_FORMAT.md). The protocol can also reject stale price data when a staleness threshold is configured.

**Resolution.** The decision that a market has ended and which outcome won. Resolution can be followed by a dispute window, during which the result can be challenged. A resolved market is not final until the window closes.

**Settlement.** The step that fixes a market's final result and makes winning positions claimable. After settlement, winners claim their payout. Settlement does not move funds by itself; each claim is a separate transaction.

**Dispute.** A challenge to a resolution during its dispute window. A disputed market holds claims until the dispute is resolved.

**Void.** A market that ends without a winning outcome. Every participant can claim a full refund.

**Cancellation.** A market or bet that is withdrawn before it becomes active, or before any bets exist. Cancellation returns the creator's deposit or the bettor's stake, depending on the case. See the [Market Lifecycle](./MARKET_LIFECYCLE.md) for which case applies.

**Claim.** The transaction a participant sends to collect a payout or refund after settlement.
