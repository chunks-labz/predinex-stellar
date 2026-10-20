/**
 * Position indexing types (Issue #1425).
 *
 * A position row is written every time a `place_bet` / PositionPlaced event is
 * indexed.  Rows are keyed by (market, account, outcome) and upserted, so the
 * stored amount always reflects the latest cumulative balance for that slot.
 * Duplicate events (same tx_hash) are ignored, making the indexer idempotent
 * over re-plays and reorgs.
 *
 * Contract event reference (contracts/predinex/src/events.rs – BetEvent):
 *   Topics: (Symbol("place_bet"), version, user: Address, pool_id: u32)
 *   Data:   { outcome: u32, amount: i128, total_yes: i128, total_no: i128 }
 */

// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

/** Zero-based outcome index emitted by the contract (0 = A / Yes, 1 = B / No). */
export type OutcomeIndex = number;

/**
 * A single indexed position row keyed on (market, account, outcome).
 *
 * `amount` is the *cumulative* bet amount in stroops for this
 * (market, account, outcome) slot, updated on each new event.
 */
export interface IndexedPosition {
  /** On-chain pool / market identifier. */
  market: number;
  /** Stellar account address of the bettor. */
  account: string;
  /** Outcome index (0 = first outcome, 1 = second outcome, etc.). */
  outcome: OutcomeIndex;
  /** Cumulative bet amount in stroops (serialised as string to avoid JS bigint truncation). */
  amount: string;
  /** Pool total for outcome 0 at the time of the last event. */
  totalYes: string;
  /** Pool total for outcome 1 at the time of the last event. */
  totalNo: string;
  /**
   * The transaction hash of the *latest* event that updated this row.
   * Used for idempotency: an event whose tx_hash already appears in the store
   * is silently skipped.
   */
  lastTxHash: string;
  /** Ledger sequence number of the last indexed event. Used for reorg detection. */
  lastLedgerSeq: number;
  /** ISO timestamp of the first time this position was written. */
  createdAt: string;
  /** ISO timestamp of the last upsert. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Input / event payload
// ---------------------------------------------------------------------------

/**
 * Normalised representation of a single `place_bet` contract event, as
 * decoded by the off-chain indexer before being handed to {@link PositionIndexer}.
 */
export interface PlaceBetEvent {
  /** Pool / market id from the event topics. */
  market: number;
  /** Bettor address from the event topics. */
  account: string;
  /** Outcome index from the event data. */
  outcome: OutcomeIndex;
  /** Bet amount (stroops) from the event data. */
  amount: string;
  /** Cumulative pool total for outcome 0 after this bet. */
  totalYes: string;
  /** Cumulative pool total for outcome 1 after this bet. */
  totalNo: string;
  /** Transaction hash; used as the idempotency key. */
  txHash: string;
  /** Ledger sequence number when the event was emitted. */
  ledgerSeq: number;
}

// ---------------------------------------------------------------------------
// Filter / query
// ---------------------------------------------------------------------------

/**
 * Filter criteria for querying the position store.
 * All fields are optional; omitting a field means "no constraint on that field".
 */
export interface PositionFilter {
  /** If set, only return positions for this market. */
  market?: number;
  /** If set, only return positions for this account. */
  account?: string;
  /** If set, only return positions for this outcome index. */
  outcome?: OutcomeIndex;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/**
 * Backing store for indexed positions.
 *
 * Implementations are expected to satisfy these invariants:
 *  - `upsert` is idempotent: re-processing an event with the same `txHash`
 *    must not change stored data.
 *  - The primary key is (market, account, outcome).  When the key already
 *    exists the stored `amount` is updated to `event.amount` and the
 *    metadata fields are refreshed.
 */
export interface PositionSource {
  /**
   * Returns the total number of positions matching `filter`.
   * No filter means "all positions".
   */
  count(filter?: PositionFilter): Promise<number>;

  /**
   * Returns one page of positions matching `filter`, ordered by
   * (market asc, account asc, outcome asc) for stable pagination.
   */
  list(offset: number, limit: number, filter?: PositionFilter): Promise<IndexedPosition[]>;

  /**
   * Upsert a position from a decoded `place_bet` event.
   *
   * Returns the upserted row. If the `txHash` was already processed the
   * existing row is returned unchanged (idempotency).
   */
  upsert(event: PlaceBetEvent): Promise<IndexedPosition>;

  /**
   * Remove all positions whose `lastLedgerSeq` is greater than `ledgerSeq`.
   * Called when a reorg is detected to roll back positions written on
   * orphaned ledgers.
   *
   * Returns the number of rows removed.
   */
  rollback(ledgerSeq: number): Promise<number>;
}
