import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    decodeSorobanEvent,
    mapEventToActivityItem,
    getUserActivityFromSoroban,
    SUPPORTED_EVENT_SCHEMA_VERSION,
} from '../../app/lib/soroban-event-service';
import type { SorobanEventServiceConfig } from '../../app/lib/soroban-event-service';

global.fetch = vi.fn();

const TEST_CONFIG: SorobanEventServiceConfig = {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/testnet',
    contractId: 'CTEST123CONTRACT',
};

const USER_ADDRESS = 'GBUSER123STELLARADDRESS';

// Issue #175: every contract event carries a schema-version Symbol at topic
// position 1. Mocks below mirror the on-chain shape: [name, version, ...ids].
const VERSION_TOPIC = { type: 'symbol', value: SUPPORTED_EVENT_SCHEMA_VERSION };

// Representative raw Soroban events (as returned by getEvents RPC)
const RAW_PLACE_BET_EVENT = {
    id: 'ledger-001',
    txHash: '0xabc123',
    ledgerClosedAt: '2024-01-15T10:00:00Z',
    ledger: 100,
    contractId: 'CTEST123CONTRACT',
    topic: [
        { type: 'symbol', value: 'place_bet' },
        VERSION_TOPIC,
        { type: 'u32', value: 5 },
        { type: 'address', value: USER_ADDRESS },
    ],
    value: [0, 5000000], // outcome A, 5 XLM
};

const RAW_CLAIM_WINNINGS_EVENT = {
    id: 'ledger-002',
    txHash: '0xdef456',
    ledgerClosedAt: '2024-01-16T12:00:00Z',
    ledger: 200,
    contractId: 'CTEST123CONTRACT',
    topic: [
        { type: 'symbol', value: 'claim_winnings' },
        VERSION_TOPIC,
        { type: 'u32', value: 5 },
        { type: 'address', value: USER_ADDRESS },
    ],
    value: { type: 'i128', value: 9800000 },
};

const RAW_CREATE_POOL_EVENT = {
    id: 'ledger-003',
    txHash: '0xghi789',
    ledgerClosedAt: '2024-01-14T08:00:00Z',
    ledger: 50,
    contractId: 'CTEST123CONTRACT',
    topic: [
        { type: 'symbol', value: 'create_pool' },
        VERSION_TOPIC,
        { type: 'u32', value: 5 },
    ],
    value: { type: 'address', value: USER_ADDRESS },
};

const RAW_SETTLE_POOL_EVENT = {
    id: 'ledger-004',
    txHash: '0xjkl012',
    ledgerClosedAt: '2024-01-17T14:00:00Z',
    ledger: 300,
    contractId: 'CTEST123CONTRACT',
    topic: [
        { type: 'symbol', value: 'settle_pool' },
        VERSION_TOPIC,
        { type: 'u32', value: 5 },
    ],
    // settle_pool data is a tuple (caller, winning_outcome, ...). Decoder reads index 1.
    value: ['GBSETTLER123', 1, 600000000, 1000000000, 20000000],
};

// ---------------------------------------------------------------------------
// decodeSorobanEvent
// ---------------------------------------------------------------------------

describe('decodeSorobanEvent', () => {
    it('decodes a place_bet event', () => {
        const decoded = decodeSorobanEvent(RAW_PLACE_BET_EVENT);
        expect(decoded).not.toBeNull();
        expect(decoded!.name).toBe('place_bet');
        expect(decoded!.poolId).toBe(5);
        expect(decoded!.user).toBe(USER_ADDRESS);
        expect(decoded!.outcome).toBe(0);
        expect(decoded!.amount).toBe(5000000);
        expect(decoded!.txHash).toBe('0xabc123');
    });

    it('decodes a claim_winnings event', () => {
        const decoded = decodeSorobanEvent(RAW_CLAIM_WINNINGS_EVENT);
        expect(decoded).not.toBeNull();
        expect(decoded!.name).toBe('claim_winnings');
        expect(decoded!.poolId).toBe(5);
        expect(decoded!.user).toBe(USER_ADDRESS);
        expect(decoded!.winnings).toBe(9800000);
    });

    it('decodes a create_pool event', () => {
        const decoded = decodeSorobanEvent(RAW_CREATE_POOL_EVENT);
        expect(decoded).not.toBeNull();
        expect(decoded!.name).toBe('create_pool');
        expect(decoded!.poolId).toBe(5);
    });

    it('decodes a settle_pool event', () => {
        const decoded = decodeSorobanEvent(RAW_SETTLE_POOL_EVENT);
        expect(decoded).not.toBeNull();
        expect(decoded!.name).toBe('settle_pool');
        expect(decoded!.poolId).toBe(5);
        expect(decoded!.winningOutcome).toBe(1);
    });

    it('returns null for unknown event names', () => {
        const raw = { ...RAW_PLACE_BET_EVENT, topic: [{ type: 'symbol', value: 'unknown_event' }] };
        expect(decodeSorobanEvent(raw)).toBeNull();
    });

    it('returns null for empty topics', () => {
        const raw = { ...RAW_PLACE_BET_EVENT, topic: [] };
        expect(decodeSorobanEvent(raw)).toBeNull();
    });

    // Issue #175 — schema version handling
    describe('schema version handling (issue #175)', () => {
        it('exposes the schema version on the decoded event', () => {
            const decoded = decodeSorobanEvent(RAW_PLACE_BET_EVENT);
            expect(decoded).not.toBeNull();
            expect(decoded!.schemaVersion).toBe(SUPPORTED_EVENT_SCHEMA_VERSION);
        });

        it('skips events with an unsupported schema version', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const raw = {
                ...RAW_PLACE_BET_EVENT,
                topic: [
                    { type: 'symbol', value: 'place_bet' },
                    { type: 'symbol', value: 'v999' },
                    { type: 'u32', value: 5 },
                    { type: 'address', value: USER_ADDRESS },
                ],
            };
            expect(decodeSorobanEvent(raw)).toBeNull();
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toContain('v999');
            warnSpy.mockRestore();
        });

        it('skips events that are missing the schema version marker entirely', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const legacyRaw = {
                ...RAW_PLACE_BET_EVENT,
                // No version marker — the old (pre-#175) topic shape
                topic: [
                    { type: 'symbol', value: 'place_bet' },
                    { type: 'u32', value: 5 },
                    { type: 'address', value: USER_ADDRESS },
                ],
            };
            expect(decodeSorobanEvent(legacyRaw)).toBeNull();
            expect(warnSpy).toHaveBeenCalledTimes(1);
            warnSpy.mockRestore();
        });

        it('decoder dispatches by (name, version) so future v2 events stay quarantined', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const v2Event = {
                ...RAW_CREATE_POOL_EVENT,
                topic: [
                    { type: 'symbol', value: 'create_pool' },
                    { type: 'symbol', value: 'v2' },
                    { type: 'u32', value: 7 },
                ],
            };
            expect(decodeSorobanEvent(v2Event)).toBeNull();
            // v1 still decodes
            const v1 = decodeSorobanEvent(RAW_CREATE_POOL_EVENT);
            expect(v1).not.toBeNull();
            expect(v1!.poolId).toBe(5);
            warnSpy.mockRestore();
        });
    });
});

// ---------------------------------------------------------------------------
// mapEventToActivityItem
// ---------------------------------------------------------------------------

describe('mapEventToActivityItem', () => {
    const EXPLORER = 'https://stellar.expert/explorer/testnet';

    it('maps place_bet to bet-placed ActivityItem', () => {
        const decoded = decodeSorobanEvent(RAW_PLACE_BET_EVENT)!;
        const item = mapEventToActivityItem(decoded, EXPLORER);
        expect(item).not.toBeNull();
        expect(item!.type).toBe('bet-placed');
        expect(item!.status).toBe('success');
        expect(item!.poolId).toBe(5);
        expect(item!.amount).toBe(5000000);
        expect(item!.event?.type).toBe('bet');
        expect(item!.event?.outcome).toBe(0);
        expect(item!.explorerUrl).toBe(`${EXPLORER}/tx/0xabc123`);
    });

    it('maps claim_winnings to winnings-claimed ActivityItem', () => {
        const decoded = decodeSorobanEvent(RAW_CLAIM_WINNINGS_EVENT)!;
        const item = mapEventToActivityItem(decoded, EXPLORER);
        expect(item).not.toBeNull();
        expect(item!.type).toBe('winnings-claimed');
        expect(item!.event?.type).toBe('claim');
        expect(item!.event?.winnerAmount).toBe(9800000);
    });

    it('maps create_pool to pool-created ActivityItem', () => {
        const decoded = decodeSorobanEvent(RAW_CREATE_POOL_EVENT)!;
        const item = mapEventToActivityItem(decoded, EXPLORER);
        expect(item).not.toBeNull();
        expect(item!.type).toBe('pool-created');
        expect(item!.event?.type).toBe('pool-creation');
    });

    it('maps settle_pool to contract-call ActivityItem', () => {
        const decoded = decodeSorobanEvent(RAW_SETTLE_POOL_EVENT)!;
        const item = mapEventToActivityItem(decoded, EXPLORER);
        expect(item).not.toBeNull();
        expect(item!.type).toBe('contract-call');
        expect(item!.event?.type).toBe('settlement');
        expect(item!.event?.outcome).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// getUserActivityFromSoroban
// ---------------------------------------------------------------------------

describe('getUserActivityFromSoroban', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches and maps Soroban events into ActivityItems', async () => {
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: async () => ({
                result: {
                    events: [RAW_PLACE_BET_EVENT, RAW_CLAIM_WINNINGS_EVENT],
                },
            }),
        } as any);

        const items = await getUserActivityFromSoroban(USER_ADDRESS, 20, TEST_CONFIG);

        expect(items).toHaveLength(2);
        // Should be sorted newest first
        expect(items[0].type).toBe('winnings-claimed');
        expect(items[1].type).toBe('bet-placed');
    });

    it('filters out events not belonging to the user', async () => {
        const otherUserEvent = {
            ...RAW_PLACE_BET_EVENT,
            topic: [
                { type: 'symbol', value: 'place_bet' },
                VERSION_TOPIC,
                { type: 'u32', value: 5 },
                { type: 'address', value: 'GBOTHER_USER_ADDRESS' },
            ],
        };

        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: async () => ({ result: { events: [otherUserEvent] } }),
        } as any);

        const items = await getUserActivityFromSoroban(USER_ADDRESS, 20, TEST_CONFIG);
        expect(items).toHaveLength(0);
    });

    it('returns empty array on RPC error', async () => {
        vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as any);
        const items = await getUserActivityFromSoroban(USER_ADDRESS, 20, TEST_CONFIG);
        expect(items).toEqual([]);
    });

    it('returns empty array when config is missing contractId', async () => {
        const items = await getUserActivityFromSoroban(USER_ADDRESS, 20, {
            ...TEST_CONFIG,
            contractId: '',
        });
        expect(fetch).not.toHaveBeenCalled();
        expect(items).toEqual([]);
    });

    it('returns empty array when RPC returns an error object', async () => {
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: async () => ({ error: { message: 'startLedger must be positive' } }),
        } as any);

        const items = await getUserActivityFromSoroban(USER_ADDRESS, 20, TEST_CONFIG);
        expect(items).toEqual([]);
    });
});
