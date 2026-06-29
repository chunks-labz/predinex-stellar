import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNetworkMismatch } from '@/lib/hooks/useNetworkMismatch';
import * as AppKitReact from '@reown/appkit/react';
import * as RuntimeConfig from '@/app/lib/runtime-config';

// Mock the dependencies
vi.mock('@reown/appkit/react', () => ({
  useAppKitNetwork: vi.fn(),
}));

vi.mock('@/app/lib/runtime-config', () => ({
  getRuntimeConfig: vi.fn(),
}));

vi.mock('@/lib/appkit-config', () => ({
  stellarNetworks: {
    mainnet: { id: 'stellar:pubnet', name: 'Stellar Mainnet' },
    testnet: { id: 'stellar:testnet', name: 'Stellar Testnet' },
  },
}));

describe('useNetworkMismatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns isMismatch: false when networks match (testnet)', () => {
    vi.mocked(AppKitReact.useAppKitNetwork).mockReturnValue({
      caipNetwork: { id: 'stellar:testnet', name: 'Stellar Testnet' },
      switchNetwork: vi.fn(),
    } as any);

    vi.mocked(RuntimeConfig.getRuntimeConfig).mockReturnValue({
      network: 'testnet',
    } as any);

    const { result } = renderHook(() => useNetworkMismatch());

    expect(result.current.isMismatch).toBe(false);
    expect(result.current.expectedNetworkType).toBe('testnet');
    expect(result.current.expectedNetworkName).toBe('Stellar Testnet');
  });

  it('returns isMismatch: true when networks mismatch (wallet on mainnet, app on testnet)', () => {
    vi.mocked(AppKitReact.useAppKitNetwork).mockReturnValue({
      caipNetwork: { id: 'stellar:pubnet', name: 'Stellar Mainnet' },
      switchNetwork: vi.fn(),
    } as any);

    vi.mocked(RuntimeConfig.getRuntimeConfig).mockReturnValue({
      network: 'testnet',
    } as any);

    const { result } = renderHook(() => useNetworkMismatch());

    expect(result.current.isMismatch).toBe(true);
    expect(result.current.expectedNetworkType).toBe('testnet');
    expect(result.current.currentNetworkName).toBe('Stellar Mainnet');
  });

  it('returns isMismatch: false when no wallet is connected', () => {
    vi.mocked(AppKitReact.useAppKitNetwork).mockReturnValue({
      caipNetwork: undefined,
      switchNetwork: vi.fn(),
    } as any);

    vi.mocked(RuntimeConfig.getRuntimeConfig).mockReturnValue({
      network: 'testnet',
    } as any);

    const { result } = renderHook(() => useNetworkMismatch());

    expect(result.current.isMismatch).toBe(false);
  });

  it('calls switchNetwork with correct target when switchNetwork is triggered', async () => {
    const mockSwitchNetwork = vi.fn();
    vi.mocked(AppKitReact.useAppKitNetwork).mockReturnValue({
      caipNetwork: { id: 'stellar:pubnet', name: 'Stellar Mainnet' },
      switchNetwork: mockSwitchNetwork,
    } as any);

    vi.mocked(RuntimeConfig.getRuntimeConfig).mockReturnValue({
      network: 'testnet',
    } as any);

    const { result } = renderHook(() => useNetworkMismatch());

    await result.current.switchNetwork();

    expect(mockSwitchNetwork).toHaveBeenCalledWith(expect.objectContaining({ id: 'stellar:testnet' }));
  });

  it('returns the Stellar Mainnet expected name when app is configured for mainnet', () => {
    vi.mocked(AppKitReact.useAppKitNetwork).mockReturnValue({
      caipNetwork: { id: 'stellar:pubnet', name: 'Stellar Mainnet' },
      switchNetwork: vi.fn(),
    } as any);

    vi.mocked(RuntimeConfig.getRuntimeConfig).mockReturnValue({
      network: 'mainnet',
    } as any);

    const { result } = renderHook(() => useNetworkMismatch());

    expect(result.current.isMismatch).toBe(false);
    expect(result.current.expectedNetworkType).toBe('mainnet');
    expect(result.current.expectedNetworkName).toBe('Stellar Mainnet');
  });
});
