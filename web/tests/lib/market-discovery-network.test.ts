import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPoolCount } from '../../app/lib/enhanced-stacks-api';
import { __resetRuntimeConfigForTests } from '../../app/lib/runtime-config';

// Compatibility-only coverage for the legacy Stacks transport selection path.
// Keep this isolated from the Soroban-shaped adapter suites.

const {
  mockFetchCallReadOnlyFunction,
  mockCvToValue,
  mockStacksMainnet,
  mockStacksTestnet,
} = vi.hoisted(() => ({
  mockFetchCallReadOnlyFunction: vi.fn(),
  mockCvToValue: vi.fn(),
  mockStacksMainnet: { client: { baseUrl: 'https://mainnet.invalid' } },
  mockStacksTestnet: { client: { baseUrl: 'https://testnet.invalid' } },
}));

vi.mock('@stacks/network', () => ({
  STACKS_MAINNET: mockStacksMainnet,
  STACKS_TESTNET: mockStacksTestnet,
}));

vi.mock('@stacks/transactions', () => ({
  fetchCallReadOnlyFunction: mockFetchCallReadOnlyFunction,
  cvToValue: mockCvToValue,
  uintCV: vi.fn((value: unknown) => ({ __mockUintCV: value })),
}));

describe('market discovery network selection compatibility', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetRuntimeConfigForTests();
    process.env = { ...originalEnv };
    vi.mocked(mockFetchCallReadOnlyFunction).mockResolvedValue({} as any);
    vi.mocked(mockCvToValue).mockReturnValue(0);
  });

  it('targets testnet when NEXT_PUBLIC_NETWORK=testnet', async () => {
    process.env.NEXT_PUBLIC_NETWORK = 'testnet';

    await getPoolCount();

    expect(mockFetchCallReadOnlyFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        network: expect.objectContaining({
          client: expect.objectContaining({
            baseUrl: expect.stringContaining('testnet'),
          }),
        }),
      })
    );
  });

  it('targets mainnet when NEXT_PUBLIC_NETWORK=mainnet', async () => {
    process.env.NEXT_PUBLIC_NETWORK = 'mainnet';

    await getPoolCount();

    expect(mockFetchCallReadOnlyFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        network: expect.objectContaining({
          client: expect.objectContaining({
            baseUrl: expect.stringContaining('mainnet'),
          }),
        }),
      })
    );
  });
});
