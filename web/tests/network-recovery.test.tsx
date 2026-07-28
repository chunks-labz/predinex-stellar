import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import React from 'react';
import { NetworkMismatchWarning } from '@/components/NetworkMismatchWarning';
import PoolIntegration from '../app/components/PoolIntegration';
import { renderWithProviders } from './helpers/renderWithProviders';
import * as AppKitReact from '@reown/appkit/react';
import * as RuntimeConfig from '../app/lib/runtime-config';
import * as WalletAdapterProvider from '@/components/WalletAdapterProvider';
import * as StacksApi from '../app/lib/stacks-api';
import { stellarNetworks } from '../lib/appkit-config';

// Mock the dependencies
vi.mock('@reown/appkit/react', () => ({
  useAppKitNetwork: vi.fn(),
  useAppKitAccount: vi.fn(),
}));

vi.mock('../app/lib/runtime-config', () => ({
  getRuntimeConfig: vi.fn(),
}));

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../app/lib/stacks-api', () => ({
  getMarkets: vi.fn(),
}));

const mockPool = {
  id: 0,
  title: 'Test Pool',
  description: 'Test Description',
  creator: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
  outcomeA: 'Yes',
  outcomeB: 'No',
  totalA: 50000000,
  totalB: 30000000,
  settled: false,
  status: 'active',
  expiryBlock: 1000,
};

describe('Network Mismatch Recovery Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default Wallet State (Connected)
    vi.mocked(AppKitReact.useAppKitAccount).mockReturnValue({ isConnected: true } as any);
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue({
      isConnected: true,
      address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as any);

    // Default App Config (expects Testnet)
    vi.mocked(RuntimeConfig.getRuntimeConfig).mockReturnValue({ network: 'testnet' } as any);
    
    // Mock API
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([mockPool as any]);
  });

  it('detects mismatch, shows warning, and recovers when network is switched', async () => {
    // 1. Initial State: MISMATCH (Wallet on Mainnet, App on Testnet)
    vi.mocked(AppKitReact.useAppKitNetwork).mockReturnValue({
      caipNetwork: stellarNetworks.mainnet,
      switchNetwork: vi.fn(),
    } as any);

    const { rerender } = renderWithProviders(
      <div className="flex flex-col">
        <NetworkMismatchWarning />
        <PoolIntegration />
      </div>
    );

    // Verify warning appears in the banner
    expect(await screen.findByText(/Network Mismatch/i)).toBeInTheDocument();
    expect(screen.getByText(stellarNetworks.mainnet.name)).toBeInTheDocument();
    expect(screen.getByText(stellarNetworks.testnet.name)).toBeInTheDocument();

    // Verify "Place Bet" button is replaced by "Wrong Network" and disabled
    const wrongNetworkBtn = screen.getByRole('button', { name: /Wrong Network/i });
    expect(wrongNetworkBtn).toBeDisabled();
    expect(screen.getByText(/Please switch to Stellar Testnet to interact/i)).toBeInTheDocument();

    // 2. Recovery: SWITCH TO SUPPORTED NETWORK (Wallet switches to Testnet)
    vi.mocked(AppKitReact.useAppKitNetwork).mockReturnValue({
      caipNetwork: stellarNetworks.testnet,
      switchNetwork: vi.fn(),
    } as any);

    // Rerender to simulate the component reacting to the hook's state change
    rerender(
      <div className="flex flex-col">
        <NetworkMismatchWarning />
        <PoolIntegration />
      </div>
    );

    // Verify warning clears
    await waitFor(() => {
      expect(screen.queryByText(/Network Mismatch/i)).not.toBeInTheDocument();
    });

    // Verify "Place Bet" button returns and is enabled
    const placeBetBtn = screen.getByRole('button', { name: /Place Bet/i });
    expect(placeBetBtn).not.toBeDisabled();
    expect(screen.queryByText(/Please switch to Stellar Testnet to interact/i)).not.toBeInTheDocument();
  });

  it('uses the production stellarNetworks configuration for verification', () => {
    // This test ensures we are actually using the production IDs in our test harness
    expect(stellarNetworks.mainnet.id).toBe('stellar:pubnet');
    expect(stellarNetworks.testnet.id).toBe('stellar:testnet');
  });
});
