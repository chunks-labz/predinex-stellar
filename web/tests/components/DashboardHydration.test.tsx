import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import * as WalletAdapterProvider from '../../app/components/WalletAdapterProvider';
import * as UserDashboardHook from '../../app/hooks/useUserActivity';
import * as ActiveBetsHook from '../../app/lib/hooks/useActiveBets';

vi.mock('../../app/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
}));

vi.mock('../../app/hooks/useUserActivity', () => ({
  useUserActivity: vi.fn(),
}));

vi.mock('../../app/lib/hooks/useActiveBets', () => ({
  useActiveBets: vi.fn(),
}));

vi.mock('../../app/components/Navbar', () => ({
  default: () => <div data-testid="navbar" />,
}));

vi.mock('../../components/RouteErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../app/components/AuthGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/EmptyState', () => ({
  EmptyState: ({ message }: { message: string }) => <p>{message}</p>,
}));

vi.mock('../../components/DisconnectedState', () => ({
  DisconnectedState: () => <div>Disconnected</div>,
}));

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="dynamic-placeholder" />,
}));

describe('Dashboard hydration loading state', () => {
  let DashboardContent: typeof import('../../app/dashboard/page').DashboardContent;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue({
      chain: 'stacks',
      isConnected: true,
      isLoading: false,
      address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    vi.mocked(UserDashboardHook.useUserActivity).mockReturnValue({
      activities: [],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    vi.mocked(ActiveBetsHook.useActiveBets).mockReturnValue({
      activeBets: [],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    document.body.innerHTML = '';
  });

  beforeEach(async () => {
    DashboardContent = (await import('../../app/dashboard/page')).DashboardContent;
  });

  it('renders a stable loading shell before the dashboard hydrates', () => {
    const html = renderToString(<DashboardContent />);

    expect(html).toContain('Loading dashboard...');
    expect(html).toContain('aria-label="Loading dashboard"');
    expect(html).not.toContain('Institutional Dashboard');
  });

  it('hydrates the dashboard loading shell without markup mismatches', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const container = document.createElement('div');
    container.innerHTML = renderToString(<DashboardContent />);
    document.body.appendChild(container);

    await act(async () => {
      hydrateRoot(container, <DashboardContent />);
    });

    expect(screen.getByText('Institutional Dashboard')).toBeInTheDocument();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
