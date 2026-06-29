import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPredinexContractEvents, getStacksCoreApiBaseUrl, predinexReadApi } from '../../app/lib/adapters/predinex-read-api';
import { makeSorobanEvent, makeSorobanEventsResponse } from '../helpers/mock-surfaces';

const {
  mockGetUserActivityFromSoroban,
  mockGetUserActivity,
  mockGetTotalVolume,
  mockGetMarkets,
} = vi.hoisted(() => ({
  mockGetUserActivityFromSoroban: vi.fn(),
  mockGetUserActivity: vi.fn(),
  mockGetTotalVolume: vi.fn(),
  mockGetMarkets: vi.fn(),
}));

vi.mock('../../app/lib/runtime-config', () => ({
  getRuntimeConfig: vi.fn(() => ({
    network: 'testnet',
    contract: {
      address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      name: 'predinex-pool',
      id: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.predinex-pool',
    },
    api: {
      coreApiUrl: 'https://api.testnet.hiro.so',
      explorerUrl: 'https://explorer.hiro.so/?chain=testnet',
      rpcUrl: 'https://api.testnet.hiro.so',
    },
    soroban: {
      rpcUrl: 'https://soroban-testnet.stellar.org',
      explorerUrl: 'https://stellar.expert/explorer/testnet',
      contractId: 'CTEST123CONTRACT',
    },
  })),
}));

vi.mock('../../app/lib/stacks-api', () => ({
  getTotalVolume: mockGetTotalVolume,
  getMarkets: mockGetMarkets,
  getUserActivity: mockGetUserActivity,
}));

vi.mock('../../app/lib/soroban-event-service', () => ({
  getUserActivityFromSoroban: mockGetUserActivityFromSoroban,
}));

global.fetch = vi.fn();

describe('predinexReadApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the configured Stacks core API base URL', () => {
    expect(getStacksCoreApiBaseUrl()).toBe('https://api.testnet.hiro.so');
  });

  it('fetches contract events using the configured contract coordinates', async () => {
    const events = [makeSorobanEvent()];
    const response = makeSorobanEventsResponse(events);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => response,
    } as unknown as Response);

    const result = await fetchPredinexContractEvents(5);

    expect(result).toEqual(response);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.testnet.hiro.so/extended/v1/contract/ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM/predinex-pool/events?limit=5'
    );
  });

  it('uses the Soroban event service for user activity reads', async () => {
    mockGetUserActivityFromSoroban.mockResolvedValue([
      {
        txId: '0xabc123',
        type: 'bet-placed',
        functionName: 'place_bet',
        timestamp: 1700000000,
        status: 'success',
        poolId: 5,
        amount: 5_000_000,
        explorerUrl: 'https://stellar.expert/explorer/testnet/tx/0xabc123',
      },
    ]);

    const result = await predinexReadApi.getUserActivitySoroban('GBUSER123STELLARADDRESS', 20);

    expect(result).toHaveLength(1);
    expect(mockGetUserActivityFromSoroban).toHaveBeenCalledWith(
      'GBUSER123STELLARADDRESS',
      20,
      {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        explorerUrl: 'https://stellar.expert/explorer/testnet',
        contractId: 'CTEST123CONTRACT',
      }
    );
  });

  it('retains the compatibility delegates still used by the app shell', () => {
    expect(predinexReadApi.getPool).toEqual(expect.any(Function));
    expect(predinexReadApi.getUserBet).toEqual(expect.any(Function));
    expect(predinexReadApi.getPoolCount).toEqual(expect.any(Function));
    expect(predinexReadApi.getUserActivitySoroban).toEqual(expect.any(Function));
    expect(predinexReadApi.getUserActivity).toBe(predinexReadApi.getUserActivitySoroban);
    expect(predinexReadApi.getTotalVolume).toBe(mockGetTotalVolume);
    expect(predinexReadApi.getMarkets).toBe(mockGetMarkets);
    expect(predinexReadApi.getStacksActivity).toBe(mockGetUserActivity);
  });
});
