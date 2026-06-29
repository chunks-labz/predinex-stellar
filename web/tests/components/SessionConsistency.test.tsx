import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../helpers/renderWithProviders';
import Navbar from '@/components/Navbar';
import AuthGuard from '@/components/AuthGuard';
import BettingSection from '@/components/BettingSection';
import * as WalletAdapterProvider from '@/components/WalletAdapterProvider';

// Mock all external dependencies
vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/StacksProvider', () => ({
  useStacks: vi.fn(() => ({
    userData: null,
    authenticate: vi.fn(),
    userSession: {},
    setUserData: vi.fn(),
    signOut: vi.fn(),
    openWalletModal: vi.fn(),
    isLoading: false,
  })),
  StacksProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../providers/ToastProvider', () => ({
  useToast: vi.fn(() => ({ showToast: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/NetworkMismatchWarning', () => ({
  NetworkMismatchWarning: () => null,
  default: () => null,
}));

vi.mock('../../components/WalletAddressCopyButton', () => ({
  WalletAddressCopyButton: ({ address }: { address: string }) => <span>{address}</span>,
  default: ({ address }: { address: string }) => <span>{address}</span>,
}));

vi.mock('../../lib/hooks/useNetworkMismatch', () => ({
  useNetworkMismatch: vi.fn(() => ({
    isMismatch: false,
    expectedNetworkType: 'testnet',
    expectedNetworkName: 'Stellar Testnet',
    currentNetworkName: 'Stellar Testnet',
    switchNetwork: vi.fn(),
  })),
}));

vi.mock('../../app/lib/hooks/useTxStatus', () => ({
  useTxStatus: vi.fn(() => [{ status: 'idle', txId: null, error: null }, vi.fn()]),
}));

vi.mock('../../app/lib/runtime-config', () => ({
  getRuntimeConfig: vi.fn(() => ({
    network: 'testnet',
    contract: { address: 'ST1', name: 'predinex-pool', id: 'ST1.predinex-pool' },
    api: { coreApiUrl: '', explorerUrl: '', rpcUrl: '' },
  })),
}));

vi.mock('@stacks/connect', () => ({
  openContractCall: vi.fn(),
}));

function importMissing(specifier: string) {
  return import(/* @vite-ignore */ specifier);
}

const mockPool = {
  id: 0, title: 'Test', description: 'Test', creator: 'ST123',
  outcomeA: 'A', outcomeB: 'B', totalA: 1000000, totalB: 2000000,
  settled: false, winningOutcome: undefined, expiry: 1000, status: 'active' as const,
};

describe('Session consistency — all surfaces use the same auth source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('all components show connected state from one useWallet source', () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue({
      chain: 'stacks',
      isConnected: true,
      isLoading: false,
      address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    // Navbar should show wallet address and sign-out
    renderWithProviders(<Navbar />);
    expect(screen.getByLabelText('Sign out')).toBeInTheDocument();

    // AuthGuard should render children
    renderWithProviders(
      <AuthGuard><div>Protected</div></AuthGuard>
    );
    expect(screen.getByText('Protected')).toBeInTheDocument();

    // BettingSection should show bet UI (not connect prompt)
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);
    expect(screen.getByText(/Bet on A/i)).toBeInTheDocument();
    expect(screen.queryByText('Connect Wallet to Bet')).not.toBeInTheDocument();
  });

  it('all components show disconnected state from one useWallet source', () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue({
      chain: 'stacks',
      isConnected: false,
      isLoading: false,
      address: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    // Navbar should show connect button
    renderWithProviders(<Navbar />);
    expect(screen.queryByLabelText('Sign out')).not.toBeInTheDocument();

    // AuthGuard should block content
    renderWithProviders(
      <AuthGuard><div>Protected</div></AuthGuard>
    );
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
    expect(screen.getByText('Authentication Required')).toBeInTheDocument();

    // BettingSection should show connect prompt
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);
    expect(screen.getByText('Connect Wallet to Bet')).toBeInTheDocument();
  });

  it('sign-out from one surface reflects everywhere (single mock flip)', () => {
    const disconnect = vi.fn();

    // Start connected
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue({
      chain: 'stacks',
      isConnected: true,
      isLoading: false,
      address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      connect: vi.fn(),
      disconnect,
    });

    renderWithProviders(<Navbar />);
    expect(screen.getByLabelText('Sign out')).toBeInTheDocument();

    // Flip to disconnected — simulating what happens when disconnect() runs
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue({
      chain: 'stacks',
      isConnected: false,
      isLoading: false,
      address: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    // AuthGuard now blocks content
    renderWithProviders(
      <AuthGuard><div>Protected</div></AuthGuard>
    );
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('no dead auth hooks remain importable', async () => {
    // These files should no longer exist — dynamic import should throw
    await expect(importMissing('../../lib/hooks/useWalletConnection')).rejects.toThrow();
    await expect(importMissing('../../lib/hooks/useAppKit')).rejects.toThrow();
    await expect(importMissing('../../lib/hooks/useNetwork')).rejects.toThrow();
  });
});
