import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NotificationDropdown from '../../components/NotificationDropdown';
import * as notificationsStore from '../../app/lib/notifications-store';

// Mock wallet so the component can render without providers
vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: () => ({ address: null, isConnected: false }),
}));

// Mock Next.js Link
vi.mock('next/link', () => ({
  default: ({ children, href, onClick }: { children: React.ReactNode; href: string; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>{children}</a>
  ),
}));

const onClose = vi.fn();

describe('NotificationDropdown', () => {
  beforeEach(() => {
    window.localStorage.clear();
    onClose.mockClear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<NotificationDropdown open={false} onClose={onClose} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows empty state when there are no notifications', () => {
    render(<NotificationDropdown open={true} onClose={onClose} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/No notifications yet/i)).toBeTruthy();
  });

  it('renders a notification with mark-read button', () => {
    notificationsStore.addNotification({ type: 'pool_settled', title: 'Pool Done', body: 'Pool 1 settled' });

    render(<NotificationDropdown open={true} onClose={onClose} />);

    expect(screen.getByText('Pool Done')).toBeTruthy();
    expect(screen.getByText('Mark read')).toBeTruthy();
  });

  it('shows mark-all-read button when there are unread notifications', () => {
    notificationsStore.addNotification({ type: 'claim_available', title: 'Claim', body: 'Winnings available', poolId: 5 });

    render(<NotificationDropdown open={true} onClose={onClose} />);

    expect(screen.getByRole('button', { name: /mark all as read/i })).toBeTruthy();
  });

  it('calls onClose when the close button is clicked', () => {
    render(<NotificationDropdown open={true} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /close notifications/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a pool link for notifications with poolId', () => {
    notificationsStore.addNotification({ type: 'dispute_filed', title: 'Dispute', body: 'Dispute raised', poolId: 42 });

    render(<NotificationDropdown open={true} onClose={onClose} />);

    const link = screen.getByRole('link', { name: /view pool/i });
    expect(link.getAttribute('href')).toBe('/pools/42');
  });
});
