/**
 * PositionIndexer – processes `place_bet` contract events (Issue #1425).
 *
 * Responsibilities
 * ─────────────────
 * 1. Accept decoded `place_bet` events and persist them via a `PositionSource`.
 * 2. Guarantee idempotency: an event whose `txHash` was already stored is
 *    silently skipped so re-plays and duplicate deliveries are safe.
 * 3. Expose a `handleReorg(ledgerSeq)` helper that rolls back any positions
 *    written on orphaned ledgers above the given sequence number.
 *
 * The indexer itself is intentionally thin: it delegates all persistence
 * decisions to the injected `PositionSource` so that the in-memory
 * implementation used in tests is trivially swapped for a database-backed one.
 *
 * Usage example
 * ─────────────
 *   const store   = new InMemoryPositionSource();
 *   const indexer = new PositionIndexer(store);
 *
 *   // called once per decoded place_bet event from the Stellar event stream
 *   const position = await indexer.process(event);
 *
 *   // called when the node reports a reorg at ledger N
 *   const removed = await indexer.handleReorg(N - 1);
 */

import type { PlaceBetEvent, IndexedPosition, PositionSource } from '../types/positions.js';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Non-empty string check. */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Validates that a string encodes a parseable BigInt. */
function isBigIntString(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  try {
    BigInt(v);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a decoded event before it is handed to the store.
 * Throws on invalid input so the caller can log and skip the event rather
 * than write corrupt data.
 */
function validateEvent(event: PlaceBetEvent): void {
  const errors: string[] = [];

  if (!Number.isInteger(event.market) || event.market < 0) {
    errors.push('market must be a non-negative integer');
  }
  if (!isNonEmptyString(event.account)) {
    errors.push('account must be a non-empty string');
  }
  if (!Number.isInteger(event.outcome) || event.outcome < 0) {
    errors.push('outcome must be a non-negative integer');
  }
  if (!isBigIntString(event.amount)) {
    errors.push('amount must be a valid integer string');
  }
  if (!isBigIntString(event.totalYes)) {
    errors.push('totalYes must be a valid integer string');
  }
  if (!isBigIntString(event.totalNo)) {
    errors.push('totalNo must be a valid integer string');
  }
  if (!isNonEmptyString(event.txHash)) {
    errors.push('txHash must be a non-empty string');
  }
  if (!Number.isInteger(event.ledgerSeq) || event.ledgerSeq < 0) {
    errors.push('ledgerSeq must be a non-negative integer');
  }

  if (errors.length > 0) {
    throw new TypeError(`Invalid PlaceBetEvent: ${errors.join('; ')}`);
  }
}

// ---------------------------------------------------------------------------
// PositionIndexer
// ---------------------------------------------------------------------------

export class PositionIndexer {
  constructor(private readonly store: PositionSource) {}

  /**
   * Process a single decoded `place_bet` event.
   *
   * - Validates the event shape; throws `TypeError` on invalid input.
   * - Delegates to `store.upsert()`, which handles idempotency by tx hash and
   *   upserts the (market, account, outcome) row.
   *
   * @returns The upserted (or existing, if duplicate) position row.
   */
  async process(event: PlaceBetEvent): Promise<IndexedPosition> {
    validateEvent(event);
    return this.store.upsert(event);
  }

  /**
   * Process multiple events in insertion order.
   *
   * Each event is processed individually so a single bad event doesn't block
   * the rest. Errors are collected and re-thrown after the valid events are
   * written, giving the caller visibility of every bad event at once.
   *
   * @returns Array of upserted rows (in the same order as `events`; skipped
   *          items have `null` in their slot – should not occur in practice
   *          since errors are re-thrown).
   */
  async processBatch(events: PlaceBetEvent[]): Promise<IndexedPosition[]> {
    const results: IndexedPosition[] = [];
    const errors: Array<{ index: number; error: unknown }> = [];

    for (let i = 0; i < events.length; i++) {
      try {
        results.push(await this.process(events[i]));
      } catch (err) {
        errors.push({ index: i, error: err });
      }
    }

    if (errors.length > 0) {
      const summary = errors
        .map(({ index, error }) => `[${index}] ${(error as Error)?.message ?? String(error)}`)
        .join('; ');
      throw new Error(`${errors.length} event(s) failed to process: ${summary}`);
    }

    return results;
  }

  /**
   * Roll back positions written on ledgers *above* `latestSafeSeq`.
   *
   * Call this when the event source signals a reorg so that positions from
   * orphaned ledgers are removed before re-processing begins.
   *
   * @param latestSafeSeq - The highest ledger sequence number that is
   *   considered canonical.  Positions with `lastLedgerSeq > latestSafeSeq`
   *   are deleted.
   * @returns The number of rows removed.
   */
  async handleReorg(latestSafeSeq: number): Promise<number> {
    return this.store.rollback(latestSafeSeq);
  }
}
