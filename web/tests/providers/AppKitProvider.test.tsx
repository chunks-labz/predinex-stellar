import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// Capture the config that AppKitProvider passes into createAppKit so we can
// inspect it. The provider calls createAppKit at module load time, so we have
// to install the mock before the provider import is evaluated.
const createAppKitMock = vi.fn();

vi.mock('@reown/appkit/react', () => ({
  createAppKit: (...args: unknown[]) => createAppKitMock(...args),
}));

vi.mock('@tanstack/react-query', () => ({
  QueryClient: class {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('AppKitProvider — issue #210', () => {
  beforeEach(() => {
    createAppKitMock.mockReset();
    vi.resetModules();

    // AppKitProvider reads NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID at module load time.
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = 'test-walletconnect-project-id';
  });



  it('initializes AppKit without any Stacks chain ids', async () => {
    await import('@/providers/AppKitProvider');

    expect(createAppKitMock).toHaveBeenCalledTimes(1);
    const config = createAppKitMock.mock.calls[0][0];

    const networks = config.networks as Array<{ id: string; chainNamespace?: string; name?: string }>;
    expect(Array.isArray(networks)).toBe(true);
    expect(networks.length).toBeGreaterThan(0);

    for (const n of networks) {
      expect(n.id.startsWith('stacks:')).toBe(false);
      expect((n.chainNamespace ?? '').toLowerCase()).not.toBe('stacks');
      expect((n.name ?? '').toLowerCase()).not.toContain('stacks');
    }

    const serialized = JSON.stringify(networks).toLowerCase();
    expect(serialized).not.toContain('stacks:mainnet');
    expect(serialized).not.toContain('stacks:testnet');
  });

  it('initializes AppKit with the documented Stellar networks', async () => {
    await import('@/providers/AppKitProvider');

    const config = createAppKitMock.mock.calls[0][0];
    const ids = (config.networks as Array<{ id: string }>).map(n => n.id).sort();

    expect(ids).toEqual(['stellar:pubnet', 'stellar:testnet']);
  });

  it('renders children inside the provider', async () => {
    const { AppKitProvider } = await import('@/providers/AppKitProvider');

    const { getByText } = render(
      <AppKitProvider>
        <div>app-content</div>
      </AppKitProvider>
    );

    expect(getByText('app-content')).toBeInTheDocument();
  });
});
