import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../helpers/renderWithProviders';
import AuthGuard from '@/components/AuthGuard';
import * as WalletAdapterProvider from '@/components/WalletAdapterProvider';

// Mock the WalletAdapterProvider hook
vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('AuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children when user is authenticated', () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue({
      chain: 'stacks',
      isConnected: true,
      isLoading: false,
      address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    renderWithProviders(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('renders fallback when user is not authenticated', () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue({
      chain: 'stacks',
      isConnected: false,
      isLoading: false,
      address: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    renderWithProviders(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>
    );

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(screen.getByText('Authentication Required')).toBeInTheDocument();
    expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue({
      chain: 'stacks',
      isConnected: false,
      isLoading: false,
      address: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    renderWithProviders(
      <AuthGuard fallback={<div>Custom Fallback</div>}>
        <div>Protected Content</div>
      </AuthGuard>
    );

    expect(screen.getByText('Custom Fallback')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('calls connect when connect wallet button is clicked', async () => {
    const connect = vi.fn();
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue({
      chain: 'stacks',
      isConnected: false,
      isLoading: false,
      address: null,
      connect,
      disconnect: vi.fn(),
    });

    const userEvent = (await import('@testing-library/user-event')).default.setup();

    renderWithProviders(<AuthGuard><div>Content</div></AuthGuard>);

    const button = screen.getByText('Connect Wallet');
    await userEvent.click(button);

    expect(connect).toHaveBeenCalledTimes(1);
  });
});
