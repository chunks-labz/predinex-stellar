import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWalletConnect } from '@/app/lib/hooks/useWalletConnect';
import { useWallet } from '@/components/WalletAdapterProvider';
import { getRuntimeConfig } from '@/app/lib/runtime-config';

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
}));

vi.mock('@/app/lib/runtime-config', () => ({
  getRuntimeConfig: vi.fn(),
}));

describe('useWalletConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRuntimeConfig).mockReturnValue({ network: 'testnet' } as any);
  });

  it('returns session: null when not connected', () => {
    vi.mocked(useWallet).mockReturnValue({ address: null, isConnected: false } as any);

    const { result } = renderHook(() => useWalletConnect());

    expect(result.current.session).toBeNull();
  });

  it('fetches the native XLM balance from Horizon when connected', async () => {
    vi.mocked(useWallet).mockReturnValue({
      address: 'GABC123',
      isConnected: true,
    } as any);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        balances: [
          { asset_type: 'credit_alphanum4', balance: '10.0000000' },
          { asset_type: 'native', balance: '42.5000000' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useWalletConnect());

    await waitFor(() => expect(result.current.session?.balance).toBe(42.5));

    expect(fetchMock).toHaveBeenCalledWith('https://horizon-testnet.stellar.org/accounts/GABC123');
    expect(result.current.session).toEqual({
      address: 'GABC123',
      isConnected: true,
      balance: 42.5,
    });

    vi.unstubAllGlobals();
  });

  it('falls back to balance: 0 when the Horizon request fails', async () => {
    vi.mocked(useWallet).mockReturnValue({
      address: 'GABC123',
      isConnected: true,
    } as any);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const { result } = renderHook(() => useWalletConnect());

    await waitFor(() => expect(result.current.session?.balance).toBe(0));

    vi.unstubAllGlobals();
  });
});
