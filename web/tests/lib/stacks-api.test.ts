import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPoolCount, getPool, fetchActivePools, getUserBet } from '../../app/lib/stacks-api';

// Compatibility-only coverage for the legacy Stacks transport layer.
// Production-facing adapter tests should prefer Soroban-shaped mocks.

const {
  mockFetchCallReadOnlyFunction,
  mockCvToValue,
  mockUintCV,
  mockPrincipalCV,
} = vi.hoisted(() => ({
  mockFetchCallReadOnlyFunction: vi.fn(),
  mockCvToValue: vi.fn(),
  mockUintCV: vi.fn((value: unknown) => ({ __mockUintCV: value })),
  mockPrincipalCV: vi.fn((value: unknown) => ({ __mockPrincipalCV: value })),
}));

vi.mock('@stacks/network', () => ({
  STACKS_MAINNET: { client: { baseUrl: 'https://mainnet.invalid' } },
  STACKS_TESTNET: { client: { baseUrl: 'https://testnet.invalid' } },
}));

vi.mock('@stacks/transactions', () => ({
  fetchCallReadOnlyFunction: mockFetchCallReadOnlyFunction,
  cvToValue: mockCvToValue,
  uintCV: mockUintCV,
  principalCV: mockPrincipalCV,
  ClarityValue: {},
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
      explorerUrl: 'https://explorer.hiro.so?chain=testnet',
      rpcUrl: 'https://api.testnet.hiro.so',
    },
  })),
  __resetRuntimeConfigForTests: vi.fn(),
}));

describe('stacks-api compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPoolCount', () => {
    it('returns pool count successfully', async () => {
      vi.mocked(mockFetchCallReadOnlyFunction).mockResolvedValue({
        type: 0,
        value: { type: 1, value: 5n },
      } as any);
      vi.mocked(mockCvToValue).mockReturnValue(5);

      const count = await getPoolCount();
      expect(count).toBe(5);
      expect(mockFetchCallReadOnlyFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'get-pool-count',
        })
      );
    });

    it('returns 0 on error', async () => {
      vi.mocked(mockFetchCallReadOnlyFunction).mockRejectedValue(new Error('Network error'));

      const count = await getPoolCount();
      expect(count).toBe(0);
    });
  });

  describe('getPool', () => {
    it('returns pool data successfully', async () => {
      const mockPoolData = {
        'pool-id': { type: 1, value: 0n },
        creator: { type: 5, value: 'ST123' },
        title: { type: 2, value: 'Test Pool' },
        description: { type: 2, value: 'Test Description' },
        'outcome-a-name': { type: 2, value: 'Outcome A' },
        'outcome-b-name': { type: 2, value: 'Outcome B' },
        'total-a': { type: 1, value: 1000000n },
        'total-b': { type: 1, value: 2000000n },
        settled: { type: 3, value: false },
        'winning-outcome': { type: 0, value: null },
        expiry: { type: 1, value: 1000n },
      };

      vi.mocked(mockFetchCallReadOnlyFunction).mockResolvedValue({
        type: 0,
        value: { type: 4, value: mockPoolData },
      } as any);
      vi.mocked(mockCvToValue).mockReturnValue({
        title: 'Test Pool',
        description: 'Test Description',
        creator: 'ST123',
        'outcome-a-name': 'Outcome A',
        'outcome-b-name': 'Outcome B',
        'total-a': 1000000n,
        'total-b': 2000000n,
        settled: false,
        'winning-outcome': null,
        expiry: 1000n,
      });

      const pool = await getPool(0);
      expect(pool).toBeTruthy();
      expect(pool?.id).toBe(0);
      expect(pool?.title).toBe('Test Pool');
      expect(mockFetchCallReadOnlyFunction).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'get-pool',
          functionArgs: [expect.objectContaining({ __mockUintCV: 0 })],
        })
      );
    });

    it('returns null when pool does not exist', async () => {
      vi.mocked(mockFetchCallReadOnlyFunction).mockResolvedValue({
        type: 0,
        value: { type: 5, value: null },
      } as any);
      vi.mocked(mockCvToValue).mockReturnValue(null);

      const pool = await getPool(999);
      expect(pool).toBeNull();
    });

    it('returns null on error', async () => {
      vi.mocked(mockFetchCallReadOnlyFunction).mockRejectedValue(new Error('Network error'));

      const pool = await getPool(0);
      expect(pool).toBeNull();
    });
  });

  describe('fetchActivePools', () => {
    it('fetches all active pools successfully', async () => {
      vi.mocked(mockFetchCallReadOnlyFunction).mockResolvedValueOnce({
        type: 0,
        value: { type: 1, value: 3n },
      } as any);
      vi.mocked(mockCvToValue).mockReturnValueOnce(3);

      const mockPoolData = {
        title: 'Pool 0',
        description: 'Desc',
        creator: 'ST123',
        'outcome-a-name': 'A',
        'outcome-b-name': 'B',
        'total-a': 1000000n,
        'total-b': 2000000n,
        settled: false,
        'winning-outcome': null,
        expiry: 1000n,
      };

      vi.mocked(mockFetchCallReadOnlyFunction).mockResolvedValue({
        type: 0,
        value: { type: 4, value: mockPoolData },
      } as any);
      vi.mocked(mockCvToValue).mockReturnValue(mockPoolData);

      const pools = await fetchActivePools();
      expect(pools).toHaveLength(3);
      expect(mockFetchCallReadOnlyFunction).toHaveBeenCalledTimes(4);
    });

    it('handles errors gracefully', async () => {
      vi.mocked(mockFetchCallReadOnlyFunction).mockRejectedValue(new Error('Network error'));

      const pools = await fetchActivePools();
      expect(pools).toEqual([]);
    });
  });

  describe('getUserBet', () => {
    it('returns user bet data successfully', async () => {
      const mockBetData = {
        'amount-a': { type: 1, value: 1000000n },
        'amount-b': { type: 1, value: 500000n },
        'total-bet': { type: 1, value: 1500000n },
      };

      const validAddress = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM';

      vi.mocked(mockFetchCallReadOnlyFunction).mockResolvedValue({
        type: 0,
        value: { type: 4, value: mockBetData },
      } as any);
      vi.mocked(mockCvToValue).mockReturnValue({
        'amount-a': 1000000,
        'amount-b': 500000,
        'total-bet': 1500000,
      });

      const bet = await getUserBet(0, validAddress);
      expect(bet).toBeTruthy();
      expect(bet?.amountA).toBe(1000000);
      expect(bet?.amountB).toBe(500000);
      expect(bet?.totalBet).toBe(1500000);
    });

    it('returns null when user has no bet', async () => {
      const validAddress = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM';
      vi.mocked(mockFetchCallReadOnlyFunction).mockResolvedValue({
        type: 0,
        value: { type: 5, value: null },
      } as any);
      vi.mocked(mockCvToValue).mockReturnValue(null);

      const bet = await getUserBet(0, validAddress);
      expect(bet).toBeNull();
    });

    it('returns null on error', async () => {
      const validAddress = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM';
      vi.mocked(mockFetchCallReadOnlyFunction).mockRejectedValue(new Error('Network error'));

      const bet = await getUserBet(0, validAddress);
      expect(bet).toBeNull();
    });
  });
});
