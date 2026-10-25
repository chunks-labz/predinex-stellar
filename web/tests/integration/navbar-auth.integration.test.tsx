import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import * as WalletAdapterProvider from '@/components/WalletAdapterProvider';

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
}));

import AuthGuard from '@/components/AuthGuard';

const connectedWallet = {
  chain: 'stacks' as const,
  isConnected: true,
  isLoading: false,
  address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
  connect: vi.fn(),
  disconnect: vi.fn(),
};

const disconnectedWallet = {
  chain: 'stacks' as const,
  isConnected: false,
  isLoading: false,
  address: null,
  connect: vi.fn(),
  disconnect: vi.fn(),
};

describe('Navbar and Auth Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows authentication required when not connected', () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(disconnectedWallet);

    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>
    );

    expect(screen.getByText(/authentication required/i)).toBeInTheDocument();
  });

  it('shows protected content when connected via Stacks', () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);

    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
    expect(screen.queryByText(/authentication required/i)).not.toBeInTheDocument();
  });
});
