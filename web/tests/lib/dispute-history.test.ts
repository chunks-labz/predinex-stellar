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

// ---------------------------------------------------------------------------
// #1309 — pool_unfrozen must say whether an admin or a bettor caused the thaw
// ---------------------------------------------------------------------------

/** A `pool_unfrozen` event using the post-fix struct payload. */
function unfrozenStructEvent(
  actor: string,
  trigger: string,
  hadCoolingDeadline: boolean,
  opts: { rpcMapForm?: boolean } = {}
) {
  const topics = [
    { type: 'symbol', value: 'pool_unfrozen' },
    { type: 'symbol', value: 'v1' },
    { type: 'u32', value: 7 },
  ];

  const plain = {
    actor: { type: 'address', value: actor },
    trigger: { type: 'symbol', value: trigger },
    had_cooling_deadline: { type: 'bool', value: hadCoolingDeadline },
  };

  const value = opts.rpcMapForm
    ? {
        map: [
          { key: { symbol: 'actor' }, val: { address: actor } },
          { key: { symbol: 'trigger' }, val: { symbol: trigger } },
          { key: { symbol: 'had_cooling_deadline' }, val: { bool: hadCoolingDeadline } },
        ],
      }
    : plain;

  return { txHash: 'tx-unfrozen', ledgerClosedAt: '2026-03-01T10:00:00Z', topic: topics, value };
}

describe('decodeDisputeEvent — pool_unfrozen trigger (#1309)', () => {
  it('reports an admin-initiated unfreeze', () => {
    const decoded = decodeDisputeEvent(
      unfrozenStructEvent('GADMIN', 'Admin', false),
      EXPLORER
    );
    expect(decoded?.actor).toBe('GADMIN');
    expect(decoded?.trigger).toBe('admin');
  });

  it('reports a cooling-period auto-thaw, not an admin action', () => {
    // This is the exact ambiguity from #1309: the actor is a bettor whose bet
    // landed after the cooling period elapsed, and consumers must not read it as
    // an administrative unfreeze.
    const decoded = decodeDisputeEvent(
      unfrozenStructEvent('GBETTOR', 'AutoThaw', true),
      EXPLORER
    );
    expect(decoded?.actor).toBe('GBETTOR');
    expect(decoded?.trigger).toBe('autoThaw');
    expect(decoded?.trigger).not.toBe('admin');
  });

  it('decodes the RPC map form of the payload', () => {
    const decoded = decodeDisputeEvent(
      unfrozenStructEvent('GADMIN', 'Admin', true, { rpcMapForm: true }),
      EXPLORER
    );
    expect(decoded?.actor).toBe('GADMIN');
    expect(decoded?.trigger).toBe('admin');
  });

  it('never renders a struct payload as the string "[object Object]"', () => {
    // Regression guard: the pre-existing scValToNative helper stringifies
    // unrecognised objects, which would have leaked into the actor field.
    const decoded = decodeDisputeEvent(unfrozenStructEvent('GADMIN', 'Admin', false), EXPLORER);
    expect(decoded?.actor).not.toBe('[object Object]');
  });

  it('still decodes legacy events that carry a bare Address payload', () => {
    // On-chain history is immutable, so events emitted before the fix must keep
    // decoding. These have no trigger, and it must not be invented.
    const decoded = decodeDisputeEvent(
      rawEvent('pool_unfrozen', 9, '2026-01-01T00:00:00Z', 'GLEGACY'),
      EXPLORER
    );
    expect(decoded?.actor).toBe('GLEGACY');
    expect(decoded?.trigger).toBeUndefined();
  });

  it('does not add a trigger to frozen or disputed events', () => {
    for (const name of ['pool_frozen', 'pool_disputed'] as const) {
      const decoded = decodeDisputeEvent(rawEvent(name, 3, '2026-01-01T00:00:00Z'), EXPLORER);
      expect(decoded?.actor).toBe('GACTOR');
      expect(decoded?.trigger).toBeUndefined();
    }
  });

  it('degrades to no trigger for an unrecognised future enum variant', () => {
    // Guessing "admin" for an unknown variant would reintroduce the exact
    // misattribution #1309 is about.
    const decoded = decodeDisputeEvent(unfrozenStructEvent('GADMIN', 'SomethingNew', false), EXPLORER);
    expect(decoded?.actor).toBe('GADMIN');
    expect(decoded?.trigger).toBeUndefined();
  });
});
