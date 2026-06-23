import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  beforeEach(async () => {
    DashboardContent = (await import('../../app/dashboard/page')).DashboardContent;
  });

  it('renders a stable loading shell before the dashboard hydrates', () => {
    render(<DashboardContent />);

    expect(screen.getByRole('status', { name: /loading dashboard/i })).toBeInTheDocument();
    expect(screen.queryByText('Institutional Dashboard')).not.toBeInTheDocument();
  });
});
