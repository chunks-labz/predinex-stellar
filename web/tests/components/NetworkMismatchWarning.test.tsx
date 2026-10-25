import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { NetworkMismatchWarning } from '@/components/NetworkMismatchWarning';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSwitchNetwork = vi.fn();

// Mock WalletAdapterProvider so component can consume useWallet
vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(() => ({ isConnected: true })),
}));

vi.mock('../../lib/hooks/useNetworkMismatch', () => ({
  useNetworkMismatch: vi.fn(() => ({
    isMismatch: true,
    expectedNetworkName: 'Stellar Mainnet',
    currentNetworkName: 'Stellar Testnet',
    expectedNetworkType: 'mainnet',
    switchNetwork: mockSwitchNetwork,
  })),
}));

vi.mock('../../app/lib/runtime-config', () => ({
  getRuntimeConfig: vi.fn(() => ({
    network: 'mainnet',
    contract: {
      address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      name: 'predinex-pool',
      id: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.predinex-pool',
    },
    api: { coreApiUrl: '', explorerUrl: '', rpcUrl: '' },
  })),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NetworkMismatchWarning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the mismatch banner when connected and mismatched', () => {
    render(<NetworkMismatchWarning />);
    expect(screen.getByText(/network mismatch/i)).toBeInTheDocument();
    expect(screen.getByText(/Stellar Testnet/i)).toBeInTheDocument();
    // "Stellar Mainnet" appears in the message and in the button text
    expect(screen.getAllByText(/Stellar Mainnet/i).length).toBeGreaterThan(0);
  });

  it('shows a switch button with the expected network name', () => {
    render(<NetworkMismatchWarning />);
    const switchBtn = screen.getByRole('button', { name: /switch to stellar mainnet/i });
    expect(switchBtn).toBeInTheDocument();
  });

  it('calls switchNetwork when the switch button is clicked', async () => {
    mockSwitchNetwork.mockResolvedValue(undefined);
    render(<NetworkMismatchWarning />);
    const switchBtn = screen.getByRole('button', { name: /switch to stellar mainnet/i });
    fireEvent.click(switchBtn);
    await waitFor(() => expect(mockSwitchNetwork).toHaveBeenCalledTimes(1));
  });

  it('disables the switch button while switching is in progress', async () => {
    // Never resolve so the loading state persists for the assertion
    mockSwitchNetwork.mockReturnValue(new Promise(() => {}));
    render(<NetworkMismatchWarning />);
    const switchBtn = screen.getByRole('button', { name: /switch to stellar mainnet/i });
    fireEvent.click(switchBtn);
    await waitFor(() => expect(switchBtn).toBeDisabled());
  });

  it('does not render when there is no mismatch', async () => {
    const { useNetworkMismatch } = vi.mocked(
      await import('../../lib/hooks/useNetworkMismatch')
    );
    useNetworkMismatch.mockReturnValue({
      isMismatch: false,
      expectedNetworkName: 'Stellar Testnet',
      currentNetworkName: 'Stellar Testnet',
      expectedNetworkType: 'testnet',
      switchNetwork: mockSwitchNetwork,
    });
    const { container } = render(<NetworkMismatchWarning />);
    expect(container.firstChild).toBeNull();
  });

  it('does not render when wallet is not connected', async () => {
    const { useWallet } = vi.mocked(await import('@/components/WalletAdapterProvider'));
    (useWallet as ReturnType<typeof vi.fn>).mockReturnValue({ isConnected: false });
    const { container } = render(<NetworkMismatchWarning />);
    expect(container.firstChild).toBeNull();
  });
});
