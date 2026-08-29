import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationPreferencesPage from '../../app/settings/notifications/page';

const updatePushPreferences = vi.fn();
const requestPermission = vi.fn();
const syncSubscription = vi.fn();

vi.mock('@/components/Navbar', () => ({
  default: () => <nav aria-label="Main navigation" />,
}));

vi.mock('../../app/lib/hooks/useWalletConnect', () => ({
  useWalletConnect: () => ({ session: { address: 'GABC123', isConnected: true } }),
}));

vi.mock('../../app/lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../../app/lib/notifications', async () => {
  const actual = await vi.importActual<typeof import('../../app/lib/notifications')>(
    '../../app/lib/notifications',
  );
  return {
    ...actual,
    updatePushPreferences: (...args: unknown[]) => updatePushPreferences(...args),
    useBrowserNotifications: () => ({
      enabled: true,
      permission: 'granted',
      supportStatus: 'supported',
      isSaving: false,
      error: null,
      setEnabled: vi.fn(),
      requestPermission,
      syncSubscription,
      disable: vi.fn(),
      sendTestNotification: vi.fn(),
    }),
  };
});

describe('/settings/notifications', () => {
  beforeEach(() => {
    localStorage.clear();
    updatePushPreferences.mockReset().mockResolvedValue(undefined);
    requestPermission.mockReset().mockResolvedValue('granted');
    syncSubscription.mockReset().mockResolvedValue(undefined);
  });

  it('renders the Web Push preference toggles', () => {
    render(<NotificationPreferencesPage />);

    expect(screen.getByRole('switch', { name: /pool settled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /pool expiring, 24h before expiry/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /claim available/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /dispute filed/i })).toBeInTheDocument();
    expect(screen.getByText(/push permission: granted/i)).toBeInTheDocument();
  });

  it('persists toggle changes to the push subscription API', async () => {
    const user = userEvent.setup();
    render(<NotificationPreferencesPage />);

    await user.click(screen.getByRole('switch', { name: /claim available/i }));

    expect(updatePushPreferences).toHaveBeenCalledWith(
      'GABC123',
      expect.objectContaining({ claimAvailable: false }),
    );
  });

  it('requests permission and syncs the subscription from the enable button', async () => {
    const user = userEvent.setup();
    render(<NotificationPreferencesPage />);

    await user.click(screen.getByRole('button', { name: /enable push/i }));

    expect(requestPermission).toHaveBeenCalled();
    expect(syncSubscription).toHaveBeenCalled();
  });
});
