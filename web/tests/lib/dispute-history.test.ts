import { describe, it, expect } from 'vitest';
import {
  DISPUTE_EVENT_NAMES,
  buildDisputeTimeline,
  decodeDisputeEvent,
  hasDisputeHistory,
  type DisputeTimelineEvent,
} from '../../app/lib/dispute-history';

const EXPLORER = 'https://stellar.expert/explorer/testnet';

function rawEvent(
  name: string,
  poolId: number,
  closedAt: string,
  caller = 'GACTOR',
  version = 'v1'
) {
  return {
    txHash: `tx-${name}-${poolId}`,
    ledgerClosedAt: closedAt,
    topic: [
      { type: 'symbol', value: name },
      { type: 'symbol', value: version },
      { type: 'u32', value: poolId },
    ],
    value: { type: 'address', value: caller },
  };
}

describe('decodeDisputeEvent', () => {
  it('decodes a pool_disputed event into a timeline entry', () => {
    const decoded = decodeDisputeEvent(rawEvent('pool_disputed', 5, '2026-03-01T10:00:00Z'), EXPLORER);
    expect(decoded).toEqual({
      type: 'disputed',
      actor: 'GACTOR',
      timestamp: Date.parse('2026-03-01T10:00:00Z') / 1000,
      txHash: 'tx-pool_disputed-5',
      explorerUrl: `${EXPLORER}/tx/tx-pool_disputed-5`,
      poolId: 5,
    });
  });

  it('maps each lifecycle event name to its type', () => {
    expect(decodeDisputeEvent(rawEvent('pool_frozen', 1, '2026-01-01T00:00:00Z'), EXPLORER)?.type).toBe('frozen');
    expect(decodeDisputeEvent(rawEvent('pool_unfrozen', 1, '2026-01-01T00:00:00Z'), EXPLORER)?.type).toBe('unfrozen');
  });

  it('returns null for unrelated events', () => {
    expect(decodeDisputeEvent(rawEvent('place_bet', 1, '2026-01-01T00:00:00Z'), EXPLORER)).toBeNull();
  });

  it('returns null for an unsupported schema version', () => {
    expect(
      decodeDisputeEvent(rawEvent('pool_disputed', 1, '2026-01-01T00:00:00Z', 'GACTOR', 'v2'), EXPLORER)
    ).toBeNull();
  });

  it('returns null when topics are empty', () => {
    expect(decodeDisputeEvent({ topic: [], value: 'GACTOR' }, EXPLORER)).toBeNull();
  });
});

describe('buildDisputeTimeline', () => {
  it('orders events chronologically (oldest first)', () => {
    const unsorted: DisputeTimelineEvent[] = [
      { type: 'unfrozen', actor: 'G', timestamp: 300, txHash: 'c', explorerUrl: '' },
      { type: 'frozen', actor: 'G', timestamp: 100, txHash: 'a', explorerUrl: '' },
      { type: 'disputed', actor: 'G', timestamp: 200, txHash: 'b', explorerUrl: '' },
    ];
    expect(buildDisputeTimeline(unsorted).map((e) => e.type)).toEqual(['frozen', 'disputed', 'unfrozen']);
  });

  it('does not mutate the input array', () => {
    const input: DisputeTimelineEvent[] = [
      { type: 'disputed', actor: 'G', timestamp: 200, txHash: 'b', explorerUrl: '' },
      { type: 'frozen', actor: 'G', timestamp: 100, txHash: 'a', explorerUrl: '' },
    ];
    buildDisputeTimeline(input);
    expect(input[0].type).toBe('disputed');
  });
});

describe('hasDisputeHistory', () => {
  it('reflects whether any events exist', () => {
    expect(hasDisputeHistory([])).toBe(false);
    expect(
      hasDisputeHistory([{ type: 'frozen', actor: 'G', timestamp: 1, txHash: 'a', explorerUrl: '' }])
    ).toBe(true);
  });
});

describe('DISPUTE_EVENT_NAMES', () => {
  it('covers the three on-chain lifecycle events', () => {
    expect(DISPUTE_EVENT_NAMES).toEqual(['pool_frozen', 'pool_disputed', 'pool_unfrozen']);
  });
});
